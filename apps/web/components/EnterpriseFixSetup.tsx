'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  getUser,
  setTierOverride,
  getFixConnections,
  connectFixBroker,
  uploadFixCertificate,
  testFixSession,
  deleteFixConnection,
  type AuthUser,
  type EnterpriseFixConnection,
  type FixSessionTestResult,
} from '../lib/api';

interface PrimeBrokerTemplate {
  id: string;
  name: string;
  badge: string;
  defaultTargetCompId: string;
  defaultHost: string;
  defaultPort: number;
  defaultVersion: string;
  logo: string;
  description: string;
}

const PRIME_BROKERS: PrimeBrokerTemplate[] = [
  {
    id: 'goldmansachs',
    name: 'Goldman Sachs Electronic Trading (GSET)',
    badge: 'Tier-1 Bulge Bracket',
    defaultTargetCompId: 'GS_GSET_FIX',
    defaultHost: 'fix.gset.goldmansachs.com',
    defaultPort: 9800,
    defaultVersion: 'FIX.4.4',
    logo: '/logos/goldmansachs.svg',
    description: 'Ultra-low latency direct market access (DMA) across global equity, FX, and futures liquidity pools.',
  },
  {
    id: 'morganstanley',
    name: 'Morgan Stanley Institutional Equity DMA',
    badge: 'Tier-1 Prime Broker',
    defaultTargetCompId: 'MS_DMA_FIX',
    defaultHost: 'fix.morganstanley.com',
    defaultPort: 9801,
    defaultVersion: 'FIX.4.4',
    logo: '/logos/morganstanley.svg',
    description: 'Institutional electronic trading gateway with algorithmic smart order routing (SOR) and dark pool execution.',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers Institutional DMA',
    badge: 'Global Institutional',
    defaultTargetCompId: 'IBKR_DMA',
    defaultHost: 'fix.interactivebrokers.com',
    defaultPort: 9802,
    defaultVersion: 'FIX.4.4',
    logo: '/logos/ibkr.svg',
    description: 'High-speed FIX 4.4 routing to 150+ worldwide market centers with automated margin risk calculations.',
  },
  {
    id: 'jpmorgan',
    name: 'J.P. Morgan Prime Brokerage FIX',
    badge: 'Bulge Bracket DMA',
    defaultTargetCompId: 'JPM_PRIME_FIX',
    defaultHost: 'fix.jpmorgan.com',
    defaultPort: 9803,
    defaultVersion: 'FIX.4.4',
    logo: '/logos/jpmorgan.svg',
    description: 'J.P. Morgan Securities global clearing, synthetic prime brokerage, and low-latency order routing.',
  },
  {
    id: 'barclays',
    name: 'Barclays Capital Institutional BARX',
    badge: 'Tier-1 Global FX',
    defaultTargetCompId: 'BARX_PROD_FIX',
    defaultHost: 'fix.barx.barclays.com',
    defaultPort: 9804,
    defaultVersion: 'FIX.4.4',
    logo: '/logos/barclays.svg',
    description: 'BARX electronic trading platform delivering deep institutional liquidity and cross-asset execution.',
  },
];

export default function EnterpriseFixSetup() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [connections, setConnections] = useState<EnterpriseFixConnection[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [selectedBroker, setSelectedBroker] = useState<PrimeBrokerTemplate>(PRIME_BROKERS[0]);
  const [senderCompId, setSenderCompId] = useState('QUANTEINSTEIN_PROD');
  const [targetCompId, setTargetCompId] = useState(PRIME_BROKERS[0].defaultTargetCompId);
  const [hostIp, setHostIp] = useState(PRIME_BROKERS[0].defaultHost);
  const [port, setPort] = useState(PRIME_BROKERS[0].defaultPort);
  const [fixVersion, setFixVersion] = useState(PRIME_BROKERS[0].defaultVersion);
  const [tlsEnabled, setTlsEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [accountIdentifier, setAccountIdentifier] = useState('INST-ALPHA-101');
  const [fixPassword, setFixPassword] = useState('');

  // Certificate State
  const [uploadedCertPath, setUploadedCertPath] = useState('');
  const [uploadedCertName, setUploadedCertName] = useState('');
  const [certFingerprint, setCertFingerprint] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Session Test State
  const [testingSession, setTestingSession] = useState(false);
  const [testResult, setTestResult] = useState<FixSessionTestResult | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage({ text, type });
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const fetchFixConnections = useCallback(async () => {
    try {
      const res = await getFixConnections();
      if (res && res.ok) {
        setConnections(res.connections || []);
      }
    } catch (err: any) {
      console.warn('Failed to load FIX connections:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const update = () => {
      const u = getUser();
      setUser(u);
    };
    update();
    fetchFixConnections();
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, [fetchFixConnections]);

  const handleSelectBrokerTemplate = useCallback((broker: PrimeBrokerTemplate) => {
    setSelectedBroker(broker);
    setTargetCompId(broker.defaultTargetCompId);
    setHostIp(broker.defaultHost);
    setPort(broker.defaultPort);
    setFixVersion(broker.defaultVersion);
    setTestResult(null);
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pem', 'crt', 'cer', 'key'].includes(ext || '')) {
      showToast('Invalid certificate. Only .pem or .crt files allowed.', 'error');
      return;
    }

    setUploadingCert(true);
    try {
      const res = await uploadFixCertificate(file);
      if (res && res.ok) {
        setUploadedCertPath(res.stored_path);
        setUploadedCertName(res.filename);
        setCertFingerprint(res.sha256_fingerprint);
        showToast(`Certificate '${res.filename}' verified and vaulted successfully.`, 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to upload certificate.', 'error');
    } finally {
      setUploadingCert(false);
    }
  }, [showToast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, [handleFileUpload]);

  const handleTestFixSession = useCallback(async () => {
    setTestingSession(true);
    setTestResult(null);
    try {
      const res = await testFixSession({
        prime_broker_name: selectedBroker.name,
        target_comp_id: targetCompId,
        host_ip: hostIp,
        port: port,
        fix_version: fixVersion,
      });
      if (res && res.ok) {
        setTestResult(res);
        showToast('FIX 4.4 Session Handshake Verified (< 200µs).', 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'FIX Handshake test failed.', 'error');
    } finally {
      setTestingSession(false);
    }
  }, [selectedBroker.name, targetCompId, hostIp, port, fixVersion, showToast]);

  const handleSaveFixConnection = useCallback(async () => {
    if (!senderCompId.trim() || !targetCompId.trim() || !hostIp.trim()) {
      showToast('SenderCompID, TargetCompID, and Host IP are required.', 'error');
      return;
    }

    setSavingConnection(true);
    try {
      const res = await connectFixBroker({
        prime_broker_name: selectedBroker.name,
        sender_comp_id: senderCompId.trim(),
        target_comp_id: targetCompId.trim(),
        host_ip: hostIp.trim(),
        port: port,
        fix_version: fixVersion,
        tls_enabled: tlsEnabled,
        tls_certificate_path: uploadedCertPath || undefined,
        password: fixPassword.trim() || undefined,
        heartbeat_interval_sec: heartbeatInterval,
        account_identifier: accountIdentifier.trim() || undefined,
      });

      if (res && res.ok) {
        showToast(`Prime Broker ${selectedBroker.name} deployed successfully!`, 'success');
        await fetchFixConnections();
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to save FIX connection.', 'error');
    } finally {
      setSavingConnection(false);
    }
  }, [
    senderCompId,
    targetCompId,
    hostIp,
    selectedBroker.name,
    port,
    fixVersion,
    tlsEnabled,
    uploadedCertPath,
    fixPassword,
    heartbeatInterval,
    accountIdentifier,
    showToast,
    fetchFixConnections,
  ]);

  const handleDeleteFix = useCallback(async (connId: string, name: string) => {
    if (!confirm(`Are you sure you want to remove the FIX gateway connection for ${name}?`)) return;
    try {
      await deleteFixConnection(connId);
      showToast(`Removed FIX connection for ${name}.`, 'success');
      await fetchFixConnections();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete connection.', 'error');
    }
  }, [showToast, fetchFixConnections]);

  // ─── STRICT TIER GATE: MUST BE ENTERPRISE ──────────────────────────────────
  const isEnterprise = user?.tier === 'ENTERPRISE' || user?.role === 'ORGANIZATION_ADMIN';

  if (!isEnterprise) {
    return (
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.95) 100%)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: 16,
          padding: 36,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          maxWidth: 680,
          margin: '30px auto',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '2px solid rgba(239, 68, 68, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            color: '#f87171',
          }}
        >
          🔒
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#f8fafc', marginBottom: 8 }}>
            Enterprise Prime Brokerage (FIX) Gated
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.6, maxWidth: 520 }}>
            Direct Market Access (DMA) via the Financial Information eXchange (FIX 4.4 / 5.0) protocol to Tier-1 Prime
            Brokers (Goldman Sachs GSET, Morgan Stanley, J.P. Morgan) is strictly restricted to verified Institutional
            Hedge Fund & Enterprise Tier accounts.
          </p>
        </div>

        <div
          style={{
            background: 'rgba(2, 6, 23, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '12px 20px',
            borderRadius: 10,
            fontSize: 12,
            color: '#cbd5e1',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>Current Account Tier:</span>
          <span
            style={{
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              padding: '3px 10px',
              borderRadius: 6,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {user?.tier || 'RETAIL'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={() => {
              const updated = setTierOverride('ENTERPRISE');
              setUser(updated);
              showToast('Switched to Institutional Enterprise Mode! Prime Brokerage FIX access unlocked.', 'success');
              fetchFixConnections();
            }}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              border: '1px solid #818cf8',
              color: '#ffffff',
              padding: '12px 24px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
              transition: 'all 0.15s ease',
            }}
          >
            ⚡ Switch to Enterprise Test Mode (Instant Unlock)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Toast */}
      {toastMessage && (
        <div
          style={{
            padding: '12px 18px',
            background:
              toastMessage.type === 'success'
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%)'
                : 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.3) 100%)',
            border:
              toastMessage.type === 'success'
                ? '1px solid rgba(16, 185, 129, 0.6)'
                : '1px solid rgba(239, 68, 68, 0.6)',
            borderRadius: 10,
            color: toastMessage.type === 'success' ? '#34d399' : '#f87171',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{toastMessage.type === 'success' ? '✓' : '⚠️'} {toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Institutional Prime Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.95) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 24 }}>🏛️</span>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>
                Prime Brokerage FIX Protocol Setup
              </h2>
              <span
                style={{
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(129, 140, 248, 0.3) 100%)',
                  border: '1px solid rgba(129, 140, 248, 0.5)',
                  color: '#c7d2fe',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                Enterprise Tier DMA
              </span>
              <button
                onClick={() => {
                  const updated = setTierOverride('RETAIL');
                  setUser(updated);
                }}
                title="Switch back to Retail tier for testing"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#94a3b8',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Switch to Retail
              </button>
            </div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, maxWidth: 680, lineHeight: 1.5 }}>
              Configure institutional low-latency FIX 4.4 and FIX 5.0SP2 Direct Market Access gateways. Provision
              mutual TLS client certificates, manage TargetCompIDs, and audit compliant Tag 35=D / 35=8 order flows.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 16,
              background: 'rgba(15, 23, 42, 0.7)',
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Protocol Standard
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#38bdf8' }}>FIX 4.4 / 5.0SP2</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255, 255, 255, 0.1)' }} />
            <div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>
                Target Latency
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#10b981' }}>&lt; 200 µs DMA</div>
            </div>
          </div>
        </div>
      </div>

      {/* Prime Broker Selector Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: 0.5 }}>
          SELECT INSTITUTIONAL PRIME BROKER
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {PRIME_BROKERS.map((pb) => {
            const isSelected = selectedBroker.id === pb.id;
            return (
              <div
                key={pb.id}
                onClick={() => handleSelectBrokerTemplate(pb)}
                style={{
                  background: isSelected
                    ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(79, 70, 229, 0.35) 100%)'
                    : 'rgba(15, 23, 42, 0.6)',
                  border: isSelected ? '1px solid #818cf8' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 0 16px rgba(99, 102, 241, 0.25)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: '#090d16',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <img src={pb.logo} alt={pb.name} width={32} height={32} style={{ objectFit: 'contain' }} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{pb.name.split(' ')[0]} {pb.name.split(' ')[1]}</div>
                  <div style={{ fontSize: 10, color: isSelected ? '#a5b4fc' : '#64748b', fontWeight: 600 }}>
                    {pb.badge}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main FIX Configuration Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left Column: Network & Identity Parameters */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.75)',
            border: '1px solid rgba(148, 163, 184, 0.15)',
            borderRadius: 14,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📡</span>
            <span>FIX Network & Session Parameters</span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
              Institutional Prime Broker
            </label>
            <input
              type="text"
              readOnly
              value={selectedBroker.name}
              style={{
                width: '100%',
                background: 'rgba(2, 6, 23, 0.6)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 12,
                fontWeight: 600,
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                TargetCompID (Tag 56)
              </label>
              <input
                type="text"
                value={targetCompId}
                onChange={(e) => setTargetCompId(e.target.value)}
                placeholder="e.g. GS_GSET_FIX"
                style={{
                  width: '100%',
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                SenderCompID (Tag 49)
              </label>
              <input
                type="text"
                value={senderCompId}
                onChange={(e) => setSenderCompId(e.target.value)}
                placeholder="QUANTEINSTEIN_PROD"
                style={{
                  width: '100%',
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                Gateway IP / Hostname
              </label>
              <input
                type="text"
                value={hostIp}
                onChange={(e) => setHostIp(e.target.value)}
                placeholder="e.g. fix.gset.goldmansachs.com"
                style={{
                  width: '100%',
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 9800)}
                style={{
                  width: '100%',
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                FIX Protocol Version
              </label>
              <select
                value={fixVersion}
                onChange={(e) => setFixVersion(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: 12,
                }}
              >
                <option value="FIX.4.4">FIX.4.4 (Institutional Default)</option>
                <option value="FIX.5.0SP2">FIX.5.0SP2 (FIXT.1.1)</option>
                <option value="FIX.4.2">FIX.4.2 (Legacy DMA)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
                Heartbeat Interval (Sec)
              </label>
              <input
                type="number"
                value={heartbeatInterval}
                onChange={(e) => setHeartbeatInterval(parseInt(e.target.value) || 30)}
                style={{
                  width: '100%',
                  background: 'rgba(2, 6, 23, 0.8)',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#f8fafc',
                  fontSize: 12,
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
              Account Identifier / SubID (Tag 1)
            </label>
            <input
              type="text"
              value={accountIdentifier}
              onChange={(e) => setAccountIdentifier(e.target.value)}
              placeholder="e.g. ALPHA_FUND_SUB1"
              style={{
                width: '100%',
                background: 'rgba(2, 6, 23, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 12,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>
              Optional FIX Password (Tag 554)
            </label>
            <input
              type="password"
              value={fixPassword}
              onChange={(e) => setFixPassword(e.target.value)}
              placeholder="Leave blank if using certificate-only authentication"
              style={{
                width: '100%',
                background: 'rgba(2, 6, 23, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#f8fafc',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            />
          </div>
        </div>

        {/* Right Column: SSL/TLS Certificate Dropzone & Handshake */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Certificate Dropzone */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(148, 163, 184, 0.15)',
              borderRadius: 14,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔐</span>
              <span>Mutual TLS Client Certificate (.pem / .crt)</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              Institutional Prime Broker connections require mutual TLS (mTLS) authentication. Drag and drop your
              signed client certificate below to securely vault it.
            </p>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: isDragging ? '2px dashed #6366f1' : '2px dashed rgba(148, 163, 184, 0.3)',
                background: isDragging ? 'rgba(99, 102, 241, 0.1)' : 'rgba(2, 6, 23, 0.5)',
                borderRadius: 12,
                padding: 24,
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pem,.crt,.cer,.key"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
              <span style={{ fontSize: 28 }}>📄</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                  {uploadingCert ? 'Vaulting Certificate...' : 'Drop .pem or .crt client certificate here'}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                  or click to browse from local workstation
                </div>
              </div>
            </div>

            {uploadedCertName && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>✓ {uploadedCertName}</span>
                  <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>VAULTED</span>
                </div>
                {certFingerprint && (
                  <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
                    SHA256: {certFingerprint}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FIX Handshake Testing Box */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(148, 163, 184, 0.15)',
              borderRadius: 14,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚡</span>
              <span>Session Verification & Deployment</span>
            </div>

            {testResult && (
              <div
                style={{
                  background: 'rgba(2, 6, 23, 0.75)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: 10,
                  padding: 12,
                  fontSize: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#38bdf8', fontWeight: 700 }}>Logon (35=A) & Heartbeat (35=0):</span>
                  <span style={{ color: '#10b981', fontWeight: 800 }}>{testResult.session_state}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Cipher Suite:</span>
                  <span style={{ color: '#cbd5e1' }}>{testResult.tls_cipher}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                  <span>Round-Trip DMA Latency:</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{testResult.handshake_latency_us} µs</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={handleTestFixSession}
                disabled={testingSession || savingConnection}
                style={{
                  flex: 1,
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  color: '#38bdf8',
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: testingSession ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {testingSession ? 'Negotiating TLS...' : '⚡ Test FIX Session'}
              </button>

              <button
                type="button"
                onClick={handleSaveFixConnection}
                disabled={savingConnection}
                style={{
                  flex: 1.3,
                  background: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
                  border: '1px solid #818cf8',
                  color: '#ffffff',
                  padding: '10px 16px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: savingConnection ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.25)',
                }}
              >
                {savingConnection ? 'Deploying...' : 'Save & Deploy FIX Session'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Existing Deployed FIX Gateways */}
      {connections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: 0.5 }}>
            DEPLOYED PRIME BROKERAGE FIX SESSIONS ({connections.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
            {connections.map((c) => (
              <div
                key={c.id}
                style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  boxShadow: '0 4px 18px rgba(99, 102, 241, 0.1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                    {c.prime_broker_name}
                  </div>
                  <span
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#34d399',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    DMA CONNECTED
                  </span>
                </div>

                <div
                  style={{
                    background: 'rgba(2, 6, 23, 0.6)',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    color: '#94a3b8',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>TargetCompID: <code style={{ color: '#e2e8f0' }}>{c.target_comp_id}</code></span>
                    <span>Version: <code style={{ color: '#e2e8f0' }}>{c.fix_version}</code></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Host: <code style={{ color: '#e2e8f0' }}>{c.host_ip}:{c.port}</code></span>
                    <span>TLS: <span style={{ color: '#38bdf8' }}>Enforced (AES-256)</span></span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    onClick={() => handleDeleteFix(c.id, c.prime_broker_name)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect Gateway
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
