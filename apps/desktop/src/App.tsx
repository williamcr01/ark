import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceShell } from '@/components/shell/WorkspaceShell'
import { useAppearance } from '@/hooks/useAppearance'

export default function App() {
  useAppearance()

  return (
    <TooltipProvider>
      <WorkspaceShell />
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
