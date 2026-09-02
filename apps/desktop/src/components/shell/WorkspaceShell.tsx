import { CreationWorkspace } from '@/components/shell/CreationWorkspace'
import { EditorWorkspace } from '@/components/shell/EditorWorkspace'
import { WorkspaceAgentModal } from '@/components/shell/WorkspaceAgentModal'
import { WorkspaceTitleBar } from '@/components/shell/WorkspaceTitleBar'
import { useChatPanelLayout } from '@/hooks/useChatPanelLayout'
import { useExternalDeckUpdates } from '@/hooks/useExternalDeckUpdates'
import { useWorkspaceRuntime } from '@/hooks/useWorkspaceRuntime'
import {
  useWorkspaceRuntimeContext,
  WorkspaceRuntimeContext,
} from '@/hooks/workspace-runtime-context'

export function WorkspaceShell() {
  const runtime = useWorkspaceRuntime()

  return (
    <WorkspaceRuntimeContext.Provider value={runtime}>
      <WorkspaceShellLayout />
    </WorkspaceRuntimeContext.Provider>
  )
}

function WorkspaceShellLayout() {
  const { workspaceMode } = useWorkspaceRuntimeContext()
  const layout = useChatPanelLayout(workspaceMode !== 'create')
  useExternalDeckUpdates()

  return (
    <div className="flex h-svh min-h-0 flex-col bg-[var(--ark-canvas)] text-foreground">
      <WorkspaceTitleBar onToggleChat={layout.handleToggleChat} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden" ref={layout.mainRef}>
        {workspaceMode === 'loading' ? (
          <div
            className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground"
            role="status"
          >
            Loading Ark…
          </div>
        ) : workspaceMode === 'create' ? (
          <CreationWorkspace />
        ) : (
          <EditorWorkspace
            chatDefaultSize={layout.chatDefaultSize}
            deckDefaultSizeWithChat={layout.deckDefaultSizeWithChat}
            onChatOpenChange={layout.handleChatOpenChange}
          />
        )}
      </main>
      <WorkspaceAgentModal />
    </div>
  )
}
