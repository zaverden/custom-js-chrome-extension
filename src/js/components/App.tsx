import MV3Tools from './MV3Tools'
import React from 'react'
import Page from './Page'
import { HashRouter, Route, Routes } from 'react-router-dom'
import HostTable from './HostTable'

export default () => (
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <MV3Tools />
    <div style={{ flex: 1, minHeight: 0 }}>
      <HashRouter>
        <Routes>
          <Route path="/list" element={<HostTable />} />
          <Route path="/" element={<Page />} />
        </Routes>
      </HashRouter>
    </div>
  </div>
)
