-- Track entity mutations (INSERT/UPDATE/DELETE) in outbox with automatic foreign key detection
CREATE OR REPLACE FUNCTION public.track_entity_mutations()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  data_fields jsonb := '{}'::jsonb;
  field_name text;
  old_value jsonb;
  new_value jsonb;
  data_to_store jsonb;
  mutation_id_value text;
  operation_name text;
  has_channels boolean := false;
  record_data record;
BEGIN
  -- Set record_data based on operation
  IF TG_OP = 'DELETE' THEN
    record_data := OLD;
  ELSE
    record_data := NEW;
  END IF;
  
  -- Determine operation type
  IF TG_OP = 'INSERT' THEN
    operation_name := 'insert';
    -- For inserts, include all non-null fields as data
    data_fields := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    operation_name := 'update';
    -- For updates, detect changed fields
    FOR field_name IN 
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME
    LOOP
      EXECUTE format('SELECT to_jsonb($1.%I), to_jsonb($2.%I)', field_name, field_name)
      INTO old_value, new_value
      USING OLD, NEW;
      
      IF old_value IS DISTINCT FROM new_value THEN
        data_fields := data_fields || jsonb_build_object(field_name, new_value);
      END IF;
    END LOOP;
    
    -- Exit if no changes for updates
    IF data_fields = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSE -- DELETE
    operation_name := 'delete';
    -- For deletes, data is always NULL
    data_fields := NULL;
  END IF;
  
  -- Check privacy via RLS policies (skip for DELETE - always NULL)
  IF TG_OP != 'DELETE' AND EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = TG_TABLE_NAME
      AND cmd = 'SELECT'
      AND qual = 'true'
      AND roles @> ARRAY['authenticated']::name[]
  ) THEN
    data_to_store := data_fields;
  ELSE
    data_to_store := NULL;
  END IF;
  
  -- Check if we'll have any channels to insert
  IF TG_OP = 'INSERT' THEN
    -- For inserts, check if we have any non-null foreign keys
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = TG_TABLE_SCHEMA
        AND tc.table_name = TG_TABLE_NAME
        AND kcu.column_name != 'id'
        AND row_to_json(NEW)->>(kcu.column_name) IS NOT NULL
    ) INTO has_channels;
    
    -- Skip if no foreign keys with values
    IF NOT has_channels THEN
      RETURN NEW;
    END IF;
  END IF;
  
  mutation_id_value := gen_random_uuid()::text;
  
  -- Insert channels based on operation type
  INSERT INTO public.outbox (mutation_id, channel, name, data, headers)
  SELECT 
    mutation_id_value,
    channel,
    operation_name,
    data_to_store,
    headers
  FROM (
    -- Primary channel (for UPDATE and DELETE)
    SELECT 
      format('%s:id:%s', TG_TABLE_NAME, record_data.id::text) AS channel,
      jsonb_build_object(
        'id', record_data.id::text, 
        'updatedAt', record_data."updatedAt"
      ) AS headers
    WHERE TG_OP IN ('UPDATE', 'DELETE')
    
    UNION ALL
    
    -- Foreign key channels for current values (INSERT, UPDATE, DELETE)
    SELECT 
      format('%s:%s:%s', TG_TABLE_NAME, fk.column_name, fk.column_value) AS channel,
      jsonb_build_object(
        'id', record_data.id::text,
        'updatedAt', record_data."updatedAt",
        fk.column_name, fk.column_value
      ) AS headers
    FROM (
      SELECT 
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = TG_TABLE_SCHEMA
        AND tc.table_name = TG_TABLE_NAME
        AND kcu.column_name != 'id'
    ) AS fk_info
    CROSS JOIN LATERAL (
      SELECT fk_info.column_name, 
             (row_to_json(record_data.*)->>(fk_info.column_name))::text AS column_value
    ) AS fk
    WHERE fk.column_value IS NOT NULL
    
    UNION ALL
    
    -- Foreign key channels for OLD values (only for UPDATE when value changed)
    SELECT 
      format('%s:%s:%s', TG_TABLE_NAME, fk.column_name, fk.old_value) AS channel,
      jsonb_build_object(
        'id', NEW.id::text,
        'updatedAt', NEW."updatedAt",
        fk.column_name || '_old', fk.old_value,
        fk.column_name || '_new', fk.new_value
      ) AS headers
    FROM (
      SELECT 
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = TG_TABLE_SCHEMA
        AND tc.table_name = TG_TABLE_NAME
        AND kcu.column_name != 'id'
    ) AS fk_info
    CROSS JOIN LATERAL (
      SELECT 
        fk_info.column_name,
        (row_to_json(OLD.*)->>(fk_info.column_name))::text AS old_value,
        (row_to_json(NEW.*)->>(fk_info.column_name))::text AS new_value
    ) AS fk
    WHERE TG_OP = 'UPDATE' 
      AND fk.old_value IS NOT NULL 
      AND fk.old_value IS DISTINCT FROM fk.new_value
  ) AS channels;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'Error in track_entity_mutations for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Apply to todos table (INSERT, UPDATE, 
DELETE)
DROP TRIGGER IF EXISTS track_mutations ON public.todos;
CREATE TRIGGER track_mutations
  AFTER INSERT OR UPDATE OR DELETE ON public.todos
  FOR EACH ROW 
  EXECUTE FUNCTION public.track_entity_mutations();

-- Apply to profiles table (INSERT, UPDATE, DELETE)
DROP TRIGGER IF EXISTS track_mutations ON public.profiles;
CREATE TRIGGER track_mutations
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW 
  EXECUTE FUNCTION public.track_entity_mutations();