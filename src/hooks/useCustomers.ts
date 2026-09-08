import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/types/db'

export function useCustomerSearch(search: string) {
  return useQuery<Customer[]>({
    queryKey: ['customers', search],
    queryFn: async () => {
      let q = supabase.from('customers').select('*')
      const term = search.trim()
      if (term) {
        const like = `%${term}%`
        q = q.or([`name.ilike.${like}`, `mc_number.ilike.${like}`, `city.ilike.${like}`].join(','))
      }
      const { data, error } = await q.order('name').limit(200)
      if (error) throw error
      return (data ?? []) as Customer[]
    },
  })
}

export function useCustomer(customerId: string | undefined) {
  return useQuery<Customer>({
    queryKey: ['customer', customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single()
      if (error) throw error
      return data as Customer
    },
  })
}

export function useSaveCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (customer: Partial<Customer> & { name: string }) => {
      if (customer.id) {
        const { error } = await supabase.from('customers').update(customer).eq('id', customer.id)
        if (error) throw error
        return customer.id
      }
      const { data, error } = await supabase
        .from('customers')
        .insert(customer)
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['customer', id] })
    },
  })
}

export interface CustomerLocation {
  id: string
  customer_id: string
  role: 'shipper' | 'pickup' | 'delivery' | 'bill_to'
  name: string | null
  address1: string | null
  city: string | null
  state: string | null
  postal: string | null
  use_count: number
  last_used_at: string
}

/**
 * "Here's what you picked last time."
 *
 * Locations this customer has actually used before, most-used and most-recent
 * first. This is what makes a red-confidence extraction recoverable in one
 * click instead of a retype — the whole point of remembering corrections.
 */
export function useCustomerLocations(
  customerId: string | null | undefined,
  role?: CustomerLocation['role'],
) {
  return useQuery<CustomerLocation[]>({
    queryKey: ['customer_locations', customerId, role],
    enabled: Boolean(customerId),
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from('customer_location_history').select('*').eq('customer_id', customerId)
      if (role) q = q.eq('role', role)
      const { data, error } = await q
        .order('use_count', { ascending: false })
        .order('last_used_at', { ascending: false })
        .limit(25)
      if (error) throw error
      return (data ?? []) as CustomerLocation[]
    },
  })
}

export function useLoadsForCustomer(customerId: string | undefined) {
  return useQuery({
    queryKey: ['customer_loads', customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_load_board')
        .select('*')
        .eq('customer_id', customerId)
        .order('first_pickup_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
  })
}
