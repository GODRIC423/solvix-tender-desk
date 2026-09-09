import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Customer, CustomerInteractionView } from '@/types/db'

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

export function useImportCustomers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rows: Record<string, string>[]) => {
      const { data, error } = await supabase.rpc('import_customers', { p_rows: rows })
      if (error) throw error
      return data as { inserted: number; updated: number; skipped: number; errors: Array<{ row: number; error: string }> }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}

export async function fetchAllCustomers(): Promise<Customer[]> {
  const out: Customer[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name')
      .range(from, from + page - 1)
    if (error) throw error
    out.push(...((data ?? []) as Customer[]))
    if (!data || data.length < page) break
  }
  return out
}

/** The activity log for one customer, newest first. */
export function useCustomerInteractions(customerId: string | undefined) {
  return useQuery<CustomerInteractionView[]>({
    queryKey: ['customer_interactions', customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_customer_interactions')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as CustomerInteractionView[]
    },
  })
}

export function useAddCustomerInteraction(customerId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      interactionTypeId: string
      body: string
      loadId?: string | null
      followUpAt?: string | null
    }) => {
      const { error } = await supabase.from('customer_interactions').insert({
        customer_id: customerId,
        interaction_type_id: input.interactionTypeId,
        body: input.body,
        load_id: input.loadId ?? null,
        follow_up_at: input.followUpAt ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer_interactions', customerId] })
      qc.invalidateQueries({ queryKey: ['customer', customerId] })
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}

/** Follow-ups that are due, across every customer — for the list's reminder strip. */
export function useDueFollowUps() {
  return useQuery<CustomerInteractionView[]>({
    queryKey: ['customer_followups_due'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_customer_interactions')
        .select('*')
        .not('follow_up_at', 'is', null)
        .lte('follow_up_at', new Date(Date.now() + 86_400_000).toISOString())
        .order('follow_up_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return (data ?? []) as CustomerInteractionView[]
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
