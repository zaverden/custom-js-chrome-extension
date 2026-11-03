import React from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@material-ui/core'
import { useStore } from './StoreContext'
import { observer } from 'mobx-react'
export default observer(() => {
  const { clearSaveError, saveError, size } = useStore().AppStore
  return (
    <span>
      {size} bytes
      {saveError && (
        <Dialog open onClose={clearSaveError}>
          <DialogTitle>Script Save Failure</DialogTitle>
          <DialogContent>
            <DialogContentText>{String(saveError)}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={clearSaveError} color="primary">
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </span>
  )
})
