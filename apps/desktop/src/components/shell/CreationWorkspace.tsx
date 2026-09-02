import { ChatPanel } from '@/components/ChatPanel'

export function CreationWorkspace() {
  return (
    <div
      className="flex min-h-0 flex-1 justify-center overflow-hidden"
      data-testid="creation-workspace"
    >
      <div className="flex h-full w-full max-w-[60rem] flex-col px-4 sm:px-6">
        <ChatPanel layout="home" />
      </div>
    </div>
  )
}
