'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import LoadingSpinner from '@/components/LoadingSpinner'

interface Applicant {
  id: string
  candidate_name: string
  candidate_email: string
  ats_score: number
  status: 'selected' | 'rejected' | 'pending' | string
  applied_at: string
  resume_url: string
  ai_feedback?: string
}

interface JobInfo { id: string; title: string; company_name: string; unique_link?: string }

export default function JobApplicantsPage() {
  const router = useRouter()
  const params = useParams()
  const jobId = params.id as string

  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/hr/login'); return }

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL
        const [jobRes, appRes] = await Promise.all([
          fetch(`${apiUrl}/api/jobs/${jobId}`),
          fetch(`${apiUrl}/api/applications/${jobId}`),
        ])

        if (jobRes.ok) {
          const jobData = await jobRes.json()
          const job = jobData.job ?? jobData
          setJobInfo({ id: job.id, title: job.title, company_name: job.company_name, unique_link: job.unique_link })
        } else {
          setError('Job not found.')
        }

        if (!appRes.ok) throw new Error(`Failed to fetch applicants (${appRes.status})`)
        const appData = await appRes.json()
        setApplicants(appData.applications ?? (Array.isArray(appData) ? appData : []))
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load applicants.')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router, jobId])

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  async function copyLink() {
    if (!jobInfo?.unique_link) return
    const link = `${window.location.origin}/apply/${jobInfo.unique_link}`
    try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2500)
  }

  const statusStyle = (status: string) => {
    if (status === 'selected') return { background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#86efac' }
    if (status === 'rejected') return { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }
    return { background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', color: '#fde68a' }
  }

  const scoreStyle = (score: number) => {
    if (score >= 70) return { color: '#86efac' }
    if (score >= 50) return { color: '#fde68a' }
    return { color: '#fca5a5' }
  }

  const selected = applicants.filter(a => a.status === 'selected').length
  const rejected = applicants.filter(a => a.status === 'rejected').length
  const pending  = applicants.filter(a => a.status === 'pending').length

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#070b1a' }}>
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size={40} color="#a78bfa" />
        <p className="text-sm" style={{ color: '#64748b' }}>Loading applicants...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#070b1a', color: '#e2e8f0' }}>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-[250px] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.12) 0%,transparent 70%)', filter: 'blur(40px)' }} />

      {/* Header */}
      <header className="sticky top-0 z-50 px-6 py-4" style={{
        background: 'rgba(7,11,26,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(124,58,237,0.2)',
      }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="font-bold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
          </div>
          <Link href="/hr/dashboard" className="flex items-center gap-2 text-sm transition-colors"
            style={{ color: '#64748b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#a78bfa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {/* Job Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{jobInfo?.title || 'Job Applicants'}</h1>
            {jobInfo?.company_name && (
              <p className="mt-1 text-sm" style={{ color: '#64748b' }}>{jobInfo.company_name}</p>
            )}
          </div>
          {jobInfo?.unique_link && (
            <button onClick={copyLink}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all flex-shrink-0"
              style={{
                background: copiedLink ? 'rgba(34,197,94,0.15)' : 'rgba(124,58,237,0.15)',
                border: copiedLink ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(124,58,237,0.3)',
                color: copiedLink ? '#86efac' : '#a78bfa',
              }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copiedLink ? 'Link Copied!' : 'Copy Apply Link'}
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total',    value: applicants.length, color: '#a78bfa' },
            { label: 'Selected', value: selected, color: '#86efac' },
            { label: 'Rejected', value: rejected, color: '#fca5a5' },
            { label: 'Pending',  value: pending,  color: '#fde68a' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-4 text-center" style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)'
            }}>
              <p className="text-2xl font-extrabold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs mt-1" style={{ color: '#475569' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl text-sm" style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5'
          }}>{error}</div>
        )}

        {/* Empty state */}
        {applicants.length === 0 && !error ? (
          <div className="rounded-2xl p-16 text-center" style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.15)'
          }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
              <svg className="w-8 h-8" style={{ color: '#7c3aed' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="font-semibold mb-1">No applicants yet</p>
            <p className="text-sm" style={{ color: '#475569' }}>Share the apply link to start receiving applications.</p>
          </div>
        ) : (
          /* Table — desktop */
          <div className="rounded-2xl overflow-hidden" style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)'
          }}>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.06)' }}>
                    {['Candidate', 'Email', 'ATS Score', 'Status', 'Applied', 'Resume'].map(h => (
                      <th key={h} className="text-left px-5 py-4 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: '#64748b' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applicants.map((a, i) => (
                    <tr key={a.id} style={{
                      borderBottom: i < applicants.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td className="px-5 py-4 font-medium">{a.candidate_name}</td>
                      <td className="px-5 py-4" style={{ color: '#94a3b8' }}>{a.candidate_email}</td>
                      <td className="px-5 py-4">
                        <span className="font-bold text-base" style={scoreStyle(a.ats_score)}>
                          {a.ats_score ?? '—'}
                          {a.ats_score != null && <span className="text-xs font-normal ml-0.5">%</span>}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold capitalize" style={statusStyle(a.status)}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap" style={{ color: '#64748b' }}>
                        {a.applied_at ? formatDate(a.applied_at) : '—'}
                      </td>
                      <td className="px-5 py-4">
                        {a.resume_url ? (
                          <a href={a.resume_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-sm font-medium transition-colors"
                            style={{ color: '#a78bfa' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#c4b5fd')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#a78bfa')}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </a>
                        ) : <span style={{ color: '#334155' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              {applicants.map(a => (
                <div key={a.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{a.candidate_name}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>{a.candidate_email}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold capitalize" style={statusStyle(a.status)}>
                      {a.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold" style={scoreStyle(a.ats_score)}>
                      ATS: {a.ats_score ?? '—'}{a.ats_score != null && '%'}
                    </span>
                    {a.resume_url && (
                      <a href={a.resume_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-medium" style={{ color: '#a78bfa' }}>
                        Download Resume
                      </a>
                    )}
                  </div>
                  {a.applied_at && (
                    <p className="text-xs" style={{ color: '#475569' }}>{formatDate(a.applied_at)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
