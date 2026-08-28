export class ApiError extends Error {
  status: number
  detail: unknown
  constructor(status: number, detail: unknown) {
    super(
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'message' in detail
          ? String((detail as { message: unknown }).message)
          : JSON.stringify(detail),
    )
    this.status = status
    this.detail = detail
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const data = await res.json()
      detail = data.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
}

export type User = { id: number; username: string; role: 'admin' | 'operator' | 'viewer'; auth_provider: 'local' | 'oidc' }

export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'

export type ProfileInput = {
  name: string
  host: string
  port: number
  database: string
  username: string
  password?: string | null
  sslmode: SslMode
  sslrootcert?: string | null
  connect_timeout: number
  read_only: boolean
  patroni_url?: string | null
  patroni_username?: string | null
  patroni_password?: string | null
}

export type Profile = Omit<ProfileInput, 'password' | 'patroni_password'> & {
  id: number
  has_password: boolean
  has_patroni_password: boolean
  created_at: string
  updated_at: string
}

export type ServerInfo = {
  version: string
  version_num: number
  current_user: string
  is_superuser: boolean
  in_recovery: boolean
  databases: string[]
}
