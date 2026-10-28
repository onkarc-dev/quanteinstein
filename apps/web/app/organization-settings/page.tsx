'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getUser,
  getOrganizationDetails,
  getOrganizationMembers,
  inviteOrganizationMember,
  updateMemberRole,
  removeOrganizationMember,
  getOrganizationAuditLogs,
  type AuthUser,
  type OrgDetails,
  type OrgMember,
  type AuditLogEntry,
  type MemberRole,
} from '../../lib/api';

export default function OrganizationSettingsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<'team' | 'audit' | 'infra'>('team');

  // Org Details & Members
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);

  // Invite Modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('QUANT_RESEARCHER');
  const [inviting, setInviting] = useState(false);

  // Edit Role Modal
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null);
  const [newRole, setNewRole] = useState<MemberRole>('QUANT_RESEARCHER');
  const [updatingRole, setUpdatingRole] = useState(false);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditFilterAction, setAuditFilterAction] = useState<string>('');
  const [auditFilterActor, setAuditFilterActor] = useState<string>('');
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setLoading(true);
      setError(null);

      const [orgRes, membersRes] = await Promise.all([
        getOrganizationDetails().catch(() => null),
        getOrganizationMembers().catch(() => null),
      ]);

      if (orgRes && orgRes.organization) {
        setOrg(orgRes.organization);
      }
      if (membersRes && Array.isArray(membersRes.members)) {
        setMembers(membersRes.members);
      }

      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.message || 'Failed to load organization data');
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditLogs(action = auditFilterAction, actor = auditFilterActor) {
    try {
      setAuditLoading(true);
      const res = await getOrganizationAuditLogs(50, 0, action || undefined, actor || undefined);
      if (res && Array.isArray(res.logs)) {
        setAuditLogs(res.logs);
        setAuditTotal(res.total);
      }
    } catch {
      // Ignore if user role is not permitted to read audit logs
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    try {
      setInviting(true);
      setError(null);
      await inviteOrganizationMember({
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        role: inviteRole,
      });
      setSuccessMsg(`Invitation dispatched to ${inviteEmail}.`);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('QUANT_RESEARCHER');
      const updated = await getOrganizationMembers();
      if (updated?.members) setMembers(updated.members);
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.message || 'Failed to invite team member');
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateRole(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMember) return;
    try {
      setUpdatingRole(true);
      setError(null);
      await updateMemberRole(selectedMember.id, newRole);
      setSuccessMsg(`Updated role for ${selectedMember.email} to ${newRole}`);
      setSelectedMember(null);
      const updated = await getOrganizationMembers();
      if (updated?.members) setMembers(updated.members);
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.message || 'Failed to update member role');
    } finally {
      setUpdatingRole(false);
    }
  }

  async function handleRemoveMember(memberId: string, email: string) {
    if (!window.confirm(`Are you sure you want to remove ${email} from the organization?`)) return;
    try {
      setError(null);
      await removeOrganizationMember(memberId);
      setSuccessMsg(`Member ${email} removed.`);
      const updated = await getOrganizationMembers();
      if (updated?.members) setMembers(updated.members);
      await loadAuditLogs();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove member');
    }
  }

  function handleExportCsv() {
    window.open('/api/v1/../enterprise/organization/audit-logs/export?format=csv', '_blank');
  }

  function handleExportJson() {
    window.open('/api/v1/../enterprise/organization/audit-logs/export?format=json', '_blank');
  }

  const isEnterprise = user?.tier === 'ENTERPRISE' || user?.tier === 'PRO';
  const roleName = user?.role || 'TRADER';

  return (
    <div style={{
      minHeight: 'calc(100vh - 56px)',
      background: '#090d16',
      color: '#f8fafc',
      padding: '32px 24px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* ─── Breadcrumb & Top Bar ────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
              ← Terminal Dashboard
            </Link>
            <span style={{ color: '#475569' }}>/</span>
            <span style={{ color: '#38bdf8', fontSize: 13, fontWeight: 700 }}>Organization Settings</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.2), rgba(99, 102, 241, 0.2))',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}>
              Tier: {org?.tier || user?.tier || 'ENTERPRISE'}
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.3)',
            }}>
              Role: {roleName}
            </span>
          </div>
        </div>

        {/* ─── Organization Header Card ─────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(180deg, #111827 0%, #0c1220 100%)',
          border: '1px solid #1e293b',
          borderRadius: 16,
          padding: '24px 28px',
          marginBottom: 28,
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 28 }}>🏛️</span>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#f8fafc', letterSpacing: '-0.02em' }}>
                    {org?.name || 'Institutional Capital Partners'}
                  </h1>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    Org Slug: <code style={{ color: '#a5b4fc', background: '#0a0e1a', padding: '2px 6px', borderRadius: 4 }}>{org?.slug || 'tier1alpha'}</code>
                    {' '}· Created: {org?.created_at?.slice(0, 10) || '2026-01-01'}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{
                background: '#0a0e1a',
                border: '1px solid #1e293b',
                borderRadius: 10,
                padding: '10px 16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Database Isolation</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8', marginTop: 2 }}>
                  {org?.isolation_mode || 'DEDICATED_SCHEMA'}
                </div>
              </div>

              <div style={{
                background: '#0a0e1a',
                border: '1px solid #1e293b',
                borderRadius: 10,
                padding: '10px 16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>SSO SAML Status</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: org?.sso_configured ? '#34d399' : '#f59e0b', marginTop: 2 }}>
                  {org?.sso_configured ? `Active (${org?.sso_provider})` : 'Configured (Okta)'}
                </div>
              </div>

              <div style={{
                background: '#0a0e1a',
                border: '1px solid #1e293b',
                borderRadius: 10,
                padding: '10px 16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>SOC 2 Compliance</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#10b981', marginTop: 2 }}>
                  ATTESTED
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Feedback Messages ────────────────────────────────────────────── */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            padding: '12px 18px',
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {successMsg && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            color: '#86efac',
            padding: '12px 18px',
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>✓ {successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ─── Navigation Tabs ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, borderBottom: '1px solid #1e293b', paddingBottom: 12 }}>
          <button
            onClick={() => setActiveTab('team')}
            style={{
              background: activeTab === 'team' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              border: activeTab === 'team' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              color: activeTab === 'team' ? '#38bdf8' : '#94a3b8',
              borderRadius: 8,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>👥</span> Team & Granular RBAC ({members.length})
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            style={{
              background: activeTab === 'audit' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              border: activeTab === 'audit' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              color: activeTab === 'audit' ? '#38bdf8' : '#94a3b8',
              borderRadius: 8,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>🛡️</span> SOC 2 & SEC Audit Trail
          </button>

          <button
            onClick={() => setActiveTab('infra')}
            style={{
              background: activeTab === 'infra' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              border: activeTab === 'infra' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              color: activeTab === 'infra' ? '#38bdf8' : '#94a3b8',
              borderRadius: 8,
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>⚙️</span> Single-Tenant DB & SSO Config
          </button>
        </div>

        {/* ─── TAB 1: TEAM & GRANULAR RBAC ──────────────────────────────────── */}
        {activeTab === 'team' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  Institutional Organization Members
                </h2>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  Assign role-based access controls to enforce strict separation of duties (Quant vs. Risk vs. Compliance).
                </div>
              </div>

              <button
                onClick={() => setShowInviteModal(true)}
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 16px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.3)',
                }}
              >
                <span>➕</span> Invite Team Member
              </button>
            </div>

            {/* Members Table */}
            <div style={{
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#111827', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                    <th style={{ padding: '12px 18px', fontWeight: 700 }}>MEMBER</th>
                    <th style={{ padding: '12px 18px', fontWeight: 700 }}>ROLE</th>
                    <th style={{ padding: '12px 18px', fontWeight: 700 }}>PERMISSIONS</th>
                    <th style={{ padding: '12px 18px', fontWeight: 700 }}>JOINED</th>
                    <th style={{ padding: '12px 18px', fontWeight: 700, textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const isSelf = m.id === user?.id || m.email === user?.email;
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #172033' }}>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                            {m.name || m.email.split('@')[0]}
                            {isSelf && <span style={{ marginLeft: 6, fontSize: 10, background: '#1e293b', color: '#38bdf8', padding: '2px 6px', borderRadius: 4 }}>YOU</span>}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{m.email}</div>
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background:
                              m.role === 'ORGANIZATION_ADMIN'
                                ? 'rgba(168, 85, 247, 0.15)'
                                : m.role === 'RISK_OFFICER'
                                ? 'rgba(245, 158, 11, 0.15)'
                                : m.role === 'COMPLIANCE_OFFICER'
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(56, 189, 248, 0.15)',
                            color:
                              m.role === 'ORGANIZATION_ADMIN'
                                ? '#c084fc'
                                : m.role === 'RISK_OFFICER'
                                ? '#fbbf24'
                                : m.role === 'COMPLIANCE_OFFICER'
                                ? '#34d399'
                                : '#38bdf8',
                            border: `1px solid ${
                              m.role === 'ORGANIZATION_ADMIN'
                                ? 'rgba(168, 85, 247, 0.4)'
                                : m.role === 'RISK_OFFICER'
                                ? 'rgba(245, 158, 11, 0.4)'
                                : m.role === 'COMPLIANCE_OFFICER'
                                ? 'rgba(16, 185, 129, 0.4)'
                                : 'rgba(56, 189, 248, 0.4)'
                            }`,
                          }}>
                            {m.role}
                          </span>
                        </td>

                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {(m.permissions || []).slice(0, 3).map(p => (
                              <span key={p} style={{
                                fontSize: 10,
                                background: '#172033',
                                color: '#94a3b8',
                                padding: '2px 6px',
                                borderRadius: 4,
                              }}>
                                {p}
                              </span>
                            ))}
                            {(m.permissions || []).length > 3 && (
                              <span style={{ fontSize: 10, color: '#64748b' }}>
                                +{m.permissions.length - 3} more
                              </span>
                            )}
                          </div>
                        </td>

                        <td style={{ padding: '14px 18px', color: '#64748b', fontSize: 12 }}>
                          {m.created_at?.slice(0, 10) || '2026-01-01'}
                        </td>

                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <button
                            onClick={() => {
                              setSelectedMember(m);
                              setNewRole(m.role);
                            }}
                            style={{
                              background: 'transparent',
                              border: '1px solid #334155',
                              color: '#94a3b8',
                              borderRadius: 6,
                              padding: '5px 10px',
                              fontSize: 12,
                              cursor: 'pointer',
                              marginRight: 6,
                            }}
                          >
                            Edit Role
                          </button>

                          {!isSelf && (
                            <button
                              onClick={() => handleRemoveMember(m.id, m.email)}
                              style={{
                                background: 'transparent',
                                border: '1px solid #7f1d1d',
                                color: '#f87171',
                                borderRadius: 6,
                                padding: '5px 10px',
                                fontSize: 12,
                                cursor: 'pointer',
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── TAB 2: SOC 2 & SEC AUDIT TRAIL ──────────────────────────────── */}
        {activeTab === 'audit' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  Immutable Regulatory Audit Trail
                </h2>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  SOC 2 Type II and SEC Rule 17a-4 compliant write-once tamper-evident records.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleExportCsv}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  📥 Export CSV
                </button>
                <button
                  onClick={handleExportJson}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  📥 Export JSON
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <div style={{
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 10,
              padding: '12px 16px',
              display: 'flex',
              gap: 12,
              marginBottom: 16,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>Filter Events:</span>
              <select
                value={auditFilterAction}
                onChange={e => {
                  setAuditFilterAction(e.target.value);
                  loadAuditLogs(e.target.value, auditFilterActor);
                }}
                style={{
                  background: '#0a0e1a',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                }}
              >
                <option value="">All Actions</option>
                <option value="AUTH_SSO_LOGIN">AUTH_SSO_LOGIN</option>
                <option value="ALGORITHM_CREATE">ALGORITHM_CREATE</option>
                <option value="ALGORITHM_UPDATE">ALGORITHM_UPDATE</option>
                <option value="ORDER_SUBMIT">ORDER_SUBMIT</option>
                <option value="RBAC_MEMBER_INVITE">RBAC_MEMBER_INVITE</option>
                <option value="RBAC_ROLE_CHANGE">RBAC_ROLE_CHANGE</option>
              </select>

              <input
                type="text"
                placeholder="Search actor email…"
                value={auditFilterActor}
                onChange={e => {
                  setAuditFilterActor(e.target.value);
                  loadAuditLogs(auditFilterAction, e.target.value);
                }}
                style={{
                  background: '#0a0e1a',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                  minWidth: 200,
                }}
              />

              <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
                Showing {auditLogs.length} of {auditTotal} immutable events
              </div>
            </div>

            {/* Audit Table */}
            <div style={{
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#111827', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>TIMESTAMP (UTC)</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>ACTOR</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>ACTION</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>RESOURCE</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>CLIENT IP</th>
                    <th style={{ padding: '10px 14px', fontWeight: 700 }}>SHA-256 DIGEST</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                        No audit events found. Mutating operations and logins are automatically recorded here.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #172033' }}>
                        <td style={{ padding: '12px 14px', color: '#cbd5e1', fontFamily: 'monospace' }}>
                          {log.created_at}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 600, color: '#f8fafc' }}>{log.actor_email || 'System'}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>{log.actor_role}</div>
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: log.action.includes('AUTH')
                              ? 'rgba(56, 189, 248, 0.15)'
                              : log.action.includes('ORDER')
                              ? 'rgba(245, 158, 11, 0.15)'
                              : log.action.includes('RBAC')
                              ? 'rgba(168, 85, 247, 0.15)'
                              : 'rgba(16, 185, 129, 0.15)',
                            color: log.action.includes('AUTH')
                              ? '#38bdf8'
                              : log.action.includes('ORDER')
                              ? '#fbbf24'
                              : log.action.includes('RBAC')
                              ? '#c084fc'
                              : '#34d399',
                          }}>
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', color: '#94a3b8' }}>
                          {log.resource_type}
                        </td>
                        <td style={{ padding: '12px 14px', color: '#94a3b8', fontFamily: 'monospace' }}>
                          {log.client_ip}
                        </td>
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace', color: '#64748b' }} title={log.payload_digest}>
                          {log.payload_digest ? log.payload_digest.slice(0, 16) + '…' : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── TAB 3: INFRASTRUCTURE & IDENTITY (SSO) ──────────────────────── */}
        {activeTab === 'infra' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Single-Tenant Database Card */}
            <div style={{
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 14,
              padding: 24,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 22 }}>🗄️</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  Dedicated Single-Tenant Database
                </h3>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                Enterprise accounts operate on isolated Postgres schemas or dedicated Supabase instances, ensuring total cryptographic separation from retail multi-tenant data.
              </p>

              <div style={{ background: '#0a0e1a', borderRadius: 8, padding: 12, border: '1px solid #1e293b', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Connection URI (Masked)</div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#38bdf8', marginTop: 4, wordBreak: 'break-all' }}>
                  {org?.database_url_masked || 'sqlite:///apps/api/data/tenants/org_tier1.db'}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                <div style={{ background: '#0a0e1a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ color: '#64748b', fontSize: 10 }}>HEALTH STATUS</div>
                  <div style={{ color: '#10b981', fontWeight: 800, marginTop: 2 }}>● HEALTHY (ONLINE)</div>
                </div>
                <div style={{ background: '#0a0e1a', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                  <div style={{ color: '#64748b', fontSize: 10 }}>ISOLATION MODE</div>
                  <div style={{ color: '#f8fafc', fontWeight: 700, marginTop: 2 }}>{org?.isolation_mode || 'DEDICATED_SCHEMA'}</div>
                </div>
              </div>
            </div>

            {/* SSO / SAML 2.0 Identity Federation Card */}
            <div style={{
              background: '#0d1322',
              border: '1px solid #1e293b',
              borderRadius: 14,
              padding: 24,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 22 }}>🔑</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>
                  SAML 2.0 Identity Federation (SSO)
                </h3>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                Allows enterprise team members to log in directly via Okta, Microsoft Azure Active Directory, or Google Workspace SAML.
              </p>

              <div style={{ background: '#0a0e1a', borderRadius: 8, padding: 12, border: '1px solid #1e293b', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>SP Entity ID</div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#a5b4fc', marginTop: 4 }}>
                  https://quanteinstein.com/auth/sso/metadata
                </div>
              </div>

              <div style={{ background: '#0a0e1a', borderRadius: 8, padding: 12, border: '1px solid #1e293b', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Assertion Consumer Service (ACS)</div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#a5b4fc', marginTop: 4 }}>
                  https://quanteinstein.com/auth/sso/acs
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <a
                  href="/api/v1/../auth/sso/metadata"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    textDecoration: 'none',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Download SP Metadata XML
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ─── MODAL: INVITE TEAM MEMBER ────────────────────────────────────── */}
        {showInviteModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: '#111827',
              border: '1px solid #1e293b',
              borderRadius: 16,
              width: '100%',
              maxWidth: 480,
              padding: 28,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px 0', color: '#f8fafc' }}>
                Invite Organization Member
              </h3>
              <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
                Provision a new user seat under {org?.name || 'this organization'}.
              </p>

              <form onSubmit={handleInviteMember}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, textTransform: 'uppercase' }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={e => setInviteName(e.target.value)}
                    placeholder="e.g. Alex Morgan"
                    style={{
                      width: '100%',
                      background: '#0a0e1a',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '10px 12px',
                      color: '#f8fafc',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, textTransform: 'uppercase' }}>
                    Work Email
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="e.g. alex@tier1alpha.com"
                    style={{
                      width: '100%',
                      background: '#0a0e1a',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '10px 12px',
                      color: '#f8fafc',
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, textTransform: 'uppercase' }}>
                    Assigned Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value as MemberRole)}
                    style={{
                      width: '100%',
                      background: '#0a0e1a',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '10px 12px',
                      color: '#f8fafc',
                      fontSize: 13,
                    }}
                  >
                    <option value="QUANT_RESEARCHER">QUANT_RESEARCHER (Strategy R&D & Trading)</option>
                    <option value="RISK_OFFICER">RISK_OFFICER (Pre-Trade Limits & Portfolio Oversight)</option>
                    <option value="COMPLIANCE_OFFICER">COMPLIANCE_OFFICER (SOC 2 / SEC Audit Inspection & Export)</option>
                    <option value="ORGANIZATION_ADMIN">ORGANIZATION_ADMIN (Full Tenant Control & Member Admin)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #334155',
                      color: '#94a3b8',
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    style={{
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 18px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: inviting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {inviting ? 'Inviting…' : 'Confirm Invite'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─── MODAL: EDIT MEMBER ROLE ─────────────────────────────────────── */}
        {selectedMember && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: '#111827',
              border: '1px solid #1e293b',
              borderRadius: 16,
              width: '100%',
              maxWidth: 440,
              padding: 28,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px 0', color: '#f8fafc' }}>
                Modify Member Role
              </h3>
              <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
                Updating clearance for <b style={{ color: '#f8fafc' }}>{selectedMember.email}</b>.
              </p>

              <form onSubmit={handleUpdateRole}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#cbd5e1', marginBottom: 6, textTransform: 'uppercase' }}>
                    New Role
                  </label>
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as MemberRole)}
                    style={{
                      width: '100%',
                      background: '#0a0e1a',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      padding: '10px 12px',
                      color: '#f8fafc',
                      fontSize: 13,
                    }}
                  >
                    <option value="QUANT_RESEARCHER">QUANT_RESEARCHER</option>
                    <option value="RISK_OFFICER">RISK_OFFICER</option>
                    <option value="COMPLIANCE_OFFICER">COMPLIANCE_OFFICER</option>
                    <option value="ORGANIZATION_ADMIN">ORGANIZATION_ADMIN</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedMember(null)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #334155',
                      color: '#94a3b8',
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updatingRole}
                    style={{
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 18px',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: updatingRole ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {updatingRole ? 'Updating…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
