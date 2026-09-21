import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { sumLines, type LineDraft } from '@/lib/documents/data'
import type { Invoice, InvoiceLine, InvoiceStatus } from '@/types/db'

/** An invoice with the bits of its load, customer and PDF the list shows. */
export interface InvoiceRow extends Invoice {
  loads: {
    load_number: string
    origin_city: string | null
    origin_state: string | null
    dest_city: string | null
    dest_state: string | null
    delivered_at: string | null
  } | null
  customers: { name: string } | null
  load_documents: { storage_path: string; file_name: string } | null
}

const SELECT =
  '*, loads(load_number, origin_city, origin_state, dest_city, dest_state, delivered_at), ' +
  'customers(name), load_documents(storage_path, file_name)'

export function useInvoices(filter: { status?: InvoiceStatus | 'all' } = {}) {
  const status = filter.status ?? 'all'
  return useQuery<InvoiceRow[]>({
    queryKey: ['invoices', status],
    queryFn: async () => {
      let q = supabase.from('invoices').select(SELECT)
      if (status !== 'all') q = q.eq('status', status)
      const { data, error } = await q
        .order('issued_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as unknown as InvoiceRow[]
    },
  })
}

export function useLoadInvoices(loadId: string | undefined) {
  return useQuery<InvoiceRow[]>({
    queryKey: ['invoices', 'load', loadId],
    enabled: Boolean(loadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select(SELECT)
        .eq('load_id', loadId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as InvoiceRow[]
    },
  })
}

export function useInvoiceLines(invoiceId: string | undefined) {
  return useQuery<InvoiceLine[]>({
    queryKey: ['invoice_lines', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as InvoiceLine[]
    },
  })
}

export interface CreateInvoiceInput {
  load_id: string
  customer_id: string | null
  issued_at: string
  due_at: string | null
  notes?: string | null
  lines: LineDraft[]
}

/** The invoice row and its lines, in that order, so a failed line insert leaves a visible draft rather than nothing. */
export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput): Promise<{ invoice: Invoice; lines: InvoiceLine[] }> => {
      const total = sumLines(input.lines)
      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert({
          load_id: input.load_id,
          customer_id: input.customer_id,
          issued_at: input.issued_at,
          due_at: input.due_at,
          subtotal: total,
          total,
          notes: input.notes ?? null,
        })
        .select('*')
        .single()
      if (error) throw error
      const inv = invoice as Invoice

      const { data: lines, error: linesError } = await supabase
        .from('invoice_lines')
        .insert(
          input.lines.map((l, i) => ({
            invoice_id: inv.id,
            description: l.description,
            quantity: l.quantity,
            rate: l.rate,
            amount: l.amount,
            sort_order: i,
          })),
        )
        .select('*')
      if (linesError) throw linesError
      return { invoice: inv, lines: (lines ?? []) as InvoiceLine[] }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  })
}

export function useUpdateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Invoice> }) => {
      const { error } = await supabase.from('invoices').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  })
}

/**
 * Recording a payment closes the loop on the load too: the invoice goes to
 * paid and, when the load has not been moved on by hand already, so does
 * its stage.
 */
export function useMarkInvoicePaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, loadId, paidStageId }: { invoiceId: string; loadId: string; paidStageId: string | null }) => {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: now })
        .eq('id', invoiceId)
      if (error) throw error
      if (paidStageId) {
        const { error: stageError } = await supabase
          .from('loads')
          .update({ pipeline_stage_id: paidStageId, last_touched_at: now })
          .eq('id', loadId)
        if (stageError) throw stageError
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      qc.invalidateQueries({ queryKey: ['load_board'] })
    },
  })
}
