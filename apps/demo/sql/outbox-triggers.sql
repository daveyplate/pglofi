-- Apply to profiles table (INSERT, UPDATE, DELETE)
DROP TRIGGER IF EXISTS track_mutations ON public.profiles;
CREATE TRIGGER track_mutations
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW 
  EXECUTE FUNCTION public.track_entity_mutations();

-- Apply to todos table (INSERT, UPDATE, DELETE)
DROP TRIGGER IF EXISTS track_mutations ON public.todos;
CREATE TRIGGER track_mutations
  AFTER INSERT OR UPDATE OR DELETE ON public.todos
  FOR EACH ROW 
  EXECUTE FUNCTION public.track_entity_mutations();