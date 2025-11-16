import { UserAvatar } from "@daveyplate/better-auth-ui"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { collections } from "@/database/collections"
import type { Profile, Todo } from "@/database/schema"

export function TodoItem({ todo }: { todo: Todo & { user: Profile | null } }) {
  return (
    <div className="flex items-center gap-3 rounded border bg-card px-3 py-2">
      <Checkbox
        checked={todo.isComplete}
        onCheckedChange={() =>
          collections.todos.update(todo.id, (draft) => {
            draft.isComplete = !draft.isComplete
          })
        }
      />

      {todo.task}

      {todo.user && (
        <Tooltip>
          <TooltipTrigger className="ms-auto cursor-default">
            <UserAvatar user={todo.user} size="sm" className="text-xs" />
          </TooltipTrigger>

          <TooltipContent>{todo.user.name}</TooltipContent>
        </Tooltip>
      )}

      <Button
        size="icon"
        variant="ghost"
        className="size-4 bg-transparent!"
        onClick={() => collections.todos.delete(todo.id)}
      >
        <XIcon />
      </Button>
    </div>
  )
}
