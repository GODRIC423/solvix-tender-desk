import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import RequireAuth from './components/RequireAuth'
import Login from './routes/Login'
import LoadBoard from './routes/LoadBoard'
import LoadDetail from './routes/LoadDetail'
import Carriers from './routes/Carriers'
import CarrierDetail from './routes/CarrierDetail'
import Customers from './routes/Customers'
import CustomerDetail from './routes/CustomerDetail'
import Settings from './routes/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/loads" replace />} />
        <Route path="/loads" element={<LoadBoard />} />
        <Route path="/loads/:id" element={<LoadDetail />} />
        <Route path="/carriers" element={<Carriers />} />
        <Route path="/carriers/:id" element={<CarrierDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/loads" replace />} />
    </Routes>
  )
}
