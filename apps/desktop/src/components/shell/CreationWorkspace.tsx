import { WorkspaceChatPanel } from '@/components/shell/WorkspaceChatPanel'
import { usePromptSubmit } from '@/hooks/usePromptSubmit'

export function CreationWorkspace() {
  const prompt = usePromptSubmit()

  return (
    <div
      className="flex min-h-0 flex-1 justify-center overflow-hidden"
      data-testid="creation-workspace"
    >
      <div className="flex h-full w-full max-w-[60rem] flex-col px-4 sm:px-6">
        <WorkspaceChatPanel layout="home" prompt={prompt} />
      </div>
    </div>
  )
}
