import React from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@material-ui/core'

export default ({ error }: any) => {
  return (
    <Dialog open>
      <DialogTitle>Can not load data</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {error || 'Open a regular HTTP(S) page and try again.'}
        </DialogContentText>
        <DialogActions>
          <Button onClick={() => window.close()}>Cancel</Button>
          <Button
            color="primary"
            onClick={() => {
              chrome.windows.create({}, () => {
                window.close()
              })
            }}
          >
            Open new window
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
