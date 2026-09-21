import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { nextVersion } from '@/lib/documents/data'
import type {
  CarrierDocument,
  CarrierDocumentKind,
  CarrierInsurance,
  CarrierInsuranceStatus,
  InsuranceCoverage,
  LoadDocument,
  LoadDocumentKind,
  LoadUploadLink,
} from '@/types/db'

export type StorageBucket = 'load-documents' | 'carrier-documents'

function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 180)
  return cleaned || 'file.bin'
}

function contentTypeOf(file: Blob, fallback = 'application/octet-stream'): string {
  return file.type && file.type.trim() !== '' ? file.type : fallback
}

/**
 * Open a private object in a new tab. The tab is opened before the signed
 * URL is fetched: browsers only allow a new window inside the click itself,
 * and the round trip to mint the URL would otherwise get it blocked.
 */
export async function openStoredFile(bucket: StorageBucket, path: string): Promise<void> {
  const win = window.open('', '_blank')
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120)
    if (error || !data?.signedUrl) throw error ?? new Error('Could not open the file.')
    if (win) {
      win.opener = null
      win.location.href = data.signedUrl
    } else {
      window.location.href = data.signedUrl
    }
  } catch (e) {
    win?.close()
    throw e
  }
}

/** Hand a generated file to the browser's download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---------------------------------------------------------------------------
// Load documents
// ---------------------------------------------------------------------------

export function useLoadDocuments(loadId: string | undefined) {
  return useQuery<LoadDocument[]>({
    queryKey: ['load_documents', loadId],
    enabled: Boolean(loadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('load_documents')
        .select('*')
        .eq('load_id', loadId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LoadDocument[]
    },
  })
}

export interface AddLoadDocumentInput {
  file: Blob
  fileName: string
  kind: LoadDocumentKind
  origin: 'generated' | 'uploaded'
  notes?: string | null
  contentType?: string
}

/** Store a file against a load: the object first, then the row that points at it. */
export function useAddLoadDocument(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddLoadDocumentInput): Promise<LoadDocument> => {
      const fileName = safeName(input.fileName)
      const contentType = input.contentType ?? contentTypeOf(input.file, 'application/pdf')
      const path = `${loadId}/${Date.now()}-${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('load-documents')
        .upload(path, input.file, { contentType, upsert: false })
      if (uploadError) throw uploadError

      const { data: existing } = await supabase
        .from('load_documents')
        .select('kind, version')
        .eq('load_id', loadId)
      const version = nextVersion((existing ?? []) as Array<Pick<LoadDocument, 'kind' | 'version'>>, input.kind)

      const { data, error } = await supabase
        .from('load_documents')
        .insert({
          load_id: loadId,
          kind: input.kind,
          origin: input.origin,
          file_name: fileName,
          storage_path: path,
          content_type: contentType,
          size_bytes: input.file.size,
          version,
          notes: input.notes ?? null,
        })
        .select('*')
        .single()
      if (error) {
        await supabase.storage.from('load-documents').remove([path])
        throw error
      }
      return data as LoadDocument
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_documents', loadId] })
    },
  })
}

export function useDeleteLoadDocument(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (doc: Pick<LoadDocument, 'id' | 'storage_path'>) => {
      const { error } = await supabase.from('load_documents').delete().eq('id', doc.id)
      if (error) throw error
      await supabase.storage.from('load-documents').remove([doc.storage_path])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_documents', loadId] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Carrier upload links
// ---------------------------------------------------------------------------

export function uploadPageUrl(token: string): string {
  return `${window.location.origin}/upload/${token}`
}

export function useUploadLinks(loadId: string | undefined) {
  return useQuery<LoadUploadLink[]>({
    queryKey: ['load_upload_links', loadId],
    enabled: Boolean(loadId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('load_upload_links')
        .select('*')
        .eq('load_id', loadId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as LoadUploadLink[]
    },
  })
}

export function useCreateUploadLink(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<LoadUploadLink> => {
      const { data, error } = await supabase
        .from('load_upload_links')
        .insert({ load_id: loadId })
        .select('*')
        .single()
      if (error) throw error
      return data as LoadUploadLink
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['load_upload_links', loadId] }),
  })
}

export function useRevokeUploadLink(loadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('load_upload_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['load_upload_links', loadId] }),
  })
}

// ---------------------------------------------------------------------------
// Carrier documents
// ---------------------------------------------------------------------------

export function useCarrierDocuments(carrierId: string | undefined) {
  return useQuery<CarrierDocument[]>({
    queryKey: ['carrier_documents', carrierId],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carrier_documents')
        .select('*')
        .eq('carrier_id', carrierId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CarrierDocument[]
    },
  })
}

export interface AddCarrierDocumentInput {
  file: Blob
  fileName: string
  kind: CarrierDocumentKind
  signedAt?: string | null
  expiresAt?: string | null
  notes?: string | null
  contentType?: string
}

export function useAddCarrierDocument(carrierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddCarrierDocumentInput): Promise<CarrierDocument> => {
      const fileName = safeName(input.fileName)
      const contentType = input.contentType ?? contentTypeOf(input.file, 'application/pdf')
      const path = `${carrierId}/${Date.now()}-${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('carrier-documents')
        .upload(path, input.file, { contentType, upsert: false })
      if (uploadError) throw uploadError

      const { data, error } = await supabase
        .from('carrier_documents')
        .insert({
          carrier_id: carrierId,
          kind: input.kind,
          file_name: fileName,
          storage_path: path,
          content_type: contentType,
          size_bytes: input.file.size,
          signed_at: input.signedAt ?? null,
          expires_at: input.expiresAt ?? null,
          notes: input.notes ?? null,
        })
        .select('*')
        .single()
      if (error) {
        await supabase.storage.from('carrier-documents').remove([path])
        throw error
      }
      return data as CarrierDocument
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carrier_documents', carrierId] }),
  })
}

export function useDeleteCarrierDocument(carrierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (doc: Pick<CarrierDocument, 'id' | 'storage_path'>) => {
      const { error } = await supabase.from('carrier_documents').delete().eq('id', doc.id)
      if (error) throw error
      await supabase.storage.from('carrier-documents').remove([doc.storage_path])
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier_documents', carrierId] })
      qc.invalidateQueries({ queryKey: ['carrier_insurance', carrierId] })
    },
  })
}

// ---------------------------------------------------------------------------
// Carrier insurance
// ---------------------------------------------------------------------------

export function useCarrierInsurance(carrierId: string | undefined) {
  return useQuery<CarrierInsurance[]>({
    queryKey: ['carrier_insurance', carrierId],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carrier_insurance')
        .select('*')
        .eq('carrier_id', carrierId)
        .order('expires_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as CarrierInsurance[]
    },
  })
}

export interface InsuranceInput {
  id?: string
  coverage: InsuranceCoverage
  insurer: string | null
  policy_number: string | null
  coverage_amount: number | null
  deductible: number | null
  effective_at: string | null
  expires_at: string | null
  certificate_document_id: string | null
  agent_name: string | null
  agent_phone: string | null
  agent_email: string | null
  notes: string | null
}

export function useSaveInsurance(carrierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: InsuranceInput) => {
      const { id, ...fields } = input
      if (id) {
        const { error } = await supabase.from('carrier_insurance').update(fields).eq('id', id)
        if (error) throw error
        return id
      }
      const { data, error } = await supabase
        .from('carrier_insurance')
        .insert({ ...fields, carrier_id: carrierId })
        .select('id')
        .single()
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier_insurance', carrierId] })
      qc.invalidateQueries({ queryKey: ['carrier_insurance_status'] })
    },
  })
}

export function useDeleteInsurance(carrierId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('carrier_insurance').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier_insurance', carrierId] })
      qc.invalidateQueries({ queryKey: ['carrier_insurance_status'] })
    },
  })
}

/** One status row per carrier, keyed by id — for the list's badges. */
export function useCarrierInsuranceStatusList() {
  return useQuery<Record<string, CarrierInsuranceStatus>>({
    queryKey: ['carrier_insurance_status', 'list'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_carrier_insurance_status').select('*').limit(5000)
      if (error) throw error
      const byId: Record<string, CarrierInsuranceStatus> = {}
      for (const row of (data ?? []) as CarrierInsuranceStatus[]) byId[row.carrier_id] = row
      return byId
    },
  })
}

export function useCarrierInsuranceStatus(carrierId: string | undefined) {
  return useQuery<CarrierInsuranceStatus | null>({
    queryKey: ['carrier_insurance_status', carrierId],
    enabled: Boolean(carrierId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_carrier_insurance_status')
        .select('*')
        .eq('carrier_id', carrierId)
        .maybeSingle()
      if (error) throw error
      return (data as CarrierInsuranceStatus | null) ?? null
    },
  })
}
