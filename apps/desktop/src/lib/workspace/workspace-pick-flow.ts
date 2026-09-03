import { toast } from 'sonner'

import { ApiResponseError } from '@ark/contracts'

export async function runWorkspacePickFlow(
  workspaceFileName: string,
  action: (path: string, overwrite: boolean) => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  let suggestedPath: string | null = null

  for (;;) {
    const path = await window.arkDesktop.files.chooseWorkspacePath(
      workspaceFileName,
      suggestedPath ?? undefined,
    )
    if (!path) return

    try {
      await action(path, false)
      toast.success(successMessage)
      return
    } catch (error) {
      if (error instanceof ApiResponseError && error.code === 'workspace_file_exists') {
        const fileName = path.split(/[\\/]/).pop() ?? path
        const overwrite = window.confirm(
          `"${fileName}" already exists in that location. Overwrite it?`,
        )

        if (!overwrite) {
          suggestedPath = path
          continue
        }

        try {
          await action(path, true)
          toast.success(successMessage)
        } catch (overwriteError) {
          toast.error(
            overwriteError instanceof Error
              ? overwriteError.message
              : 'Could not save the workspace.',
          )
        }
        return
      }

      if (error instanceof ApiResponseError && error.code === 'workspace_already_open') {
        toast.error('That workspace is already open in Ark. Choose a different name.')
        suggestedPath = path
        continue
      }

      toast.error(error instanceof Error ? error.message : 'Could not save the workspace.')
      return
    }
  }
}
