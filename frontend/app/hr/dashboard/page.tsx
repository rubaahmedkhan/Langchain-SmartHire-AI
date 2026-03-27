'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import LoadingSpinner from '@/components/LoadingSpinner'

interface Job {
  id: string
  title: string
  company_name: string
  created_at: string
  applicant_count: number
}

interface Stats {
  totalJobs: number
  totalApplications: number
}

export default function HRDashboardPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<Stats>({ totalJobs: 0, totalApplications: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hrName, setHrName] = useState('')

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/hr/login'); return }
      const userId = session.user.id
      setHrName(session.user.user_metadata?.name || session.user.email || 'HR')
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL
        const res = await fetch(`${apiUrl}/api/jobs/hr/${userId}`)
        if (!res.ok) throw new Error(`Failed to fetch jobs (${res.status})`)
        const data = await res.json()
        const jobList: Job[] = data.jobs ?? []
        setJobs(jobList)
        setStats({
          totalJobs: jobList.length,
          totalApplications: jobList.reduce((a, j) => a + (j.applicant_count || 0), 0),
        })
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.')
      } finally { setLoading(false) }
    }
    init()
  }, [router])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#070b1a' }}>
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size={40} color="#a78bfa" />
        <p className="text-sm" style={{ color: '#64748b' }}>Loading dashboard...</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#070b1a', color: '#e2e8f0' }}>
      {/* Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] pointer-events-none z-0"
        style={{ background: 'radial-gradient(ellipse,rgba(124,58,237,0.15) 0%,transparent 70%)', filter: 'blur(40px)' }} />

      {/* Header */}
      <header className="sticky top-0 z-50 px-6 py-4" style={{
        background: 'rgba(7,11,26,0.9)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(124,58,237,0.2)',
      }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)' }}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
              </svg>
            </div>
            <span className="text-lg font-bold" style={{ color: '#a78bfa' }}>SmartHire AI</span>
            <span style={{ color: '#1e293b' }}>|</span>
            <span className="text-sm hidden sm:block" style={{ color: '#475569' }}>Welcome, {hrName}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/hr/post-job"
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', boxShadow: '0 0 16px rgba(124,58,237,0.4)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Post New Job</span>
              <span className="sm:hidden">Post</span>
            </Link>
            <button onClick={handleSignOut} className="text-sm transition-colors px-3 py-2 rounded-lg"
              style={{ color: '#475569' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
              onMouseLeave={e => (e.currentTarget.style.color = '#475569')}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[
            { label: 'Total Jobs', value: stats.totalJobs, icon: '💼', color: '#7c3aed' },
            { label: 'Total Applications', value: stats.totalApplications, icon: '📄', color: '#06b6d4' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl p-5 sm:p-6" style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)', backdropFilter: 'blur(8px)'
            }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#475569' }}>{s.label}</p>
              <p className="text-3xl sm:text-4xl font-extrabold" style={{
                background: `linear-gradient(90deg,${s.color},#a78bfa)`,
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
              }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Section title */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Your Job Postings</h2>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-xl text-sm mb-6" style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5'
          }}>{error}</div>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-2xl p-16 text-center" style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.15)'
          }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>
              <svg className="w-8 h-8" style={{ color: '#7c3aed' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="font-semibold mb-1">No job postings yet</p>
            <p className="text-sm mb-6" style={{ color: '#475569' }}>Post your first job to start screening candidates with AI.</p>
            <Link href="/hr/post-job"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', color: '#fff' }}>
              Post Your First Job
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {jobs.map((job) => (
              <div key={job.id} className="rounded-2xl p-6 flex flex-col gap-4 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(124,58,237,0.2)',
                  backdropFilter: 'blur(8px)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.5)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(124,58,237,0.2)')}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-base leading-snug">{job.title}</h3>
                    <p className="text-sm mt-0.5" style={{ color: '#64748b' }}>{job.company_name}</p>
                  </div>
                  <span className="text-xs flex-shrink-0 mt-1" style={{ color: '#475569' }}>{formatDate(job.created_at)}</span>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(124,58,237,0.1)' }}>
                  <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#a78bfa' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm font-semibold" style={{ color: '#a78bfa' }}>{job.applicant_count || 0}</span>
                  <span className="text-sm" style={{ color: '#64748b' }}>Applicants</span>
                </div>

                <Link href={`/hr/job/${job.id}`}
                  className="block w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.3)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.15)' }}>
                  View Applicants →
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
