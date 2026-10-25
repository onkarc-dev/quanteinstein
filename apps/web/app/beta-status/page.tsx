'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface Comment {
  id: string;
  author: string;
  author_handle: string;
  author_badge?: string;
  created_at: string;
  text: string;
}

interface Chapter {
  time: string;
  title: string;
}

interface StrategyBlueprint {
  name: string;
  sharpe_ratio: number;
  win_rate_pct: number;
  max_drawdown_pct: number;
  rules_summary: string;
}

interface Post {
  id: string;
  author: string;
  author_handle: string;
  author_avatar: string;
  author_badge?: string;
  created_at: string;
  timestamp_iso?: string;
  post_type: 'vlog' | 'news_signal' | 'strategy' | 'general';
  symbol: string;
  asset_class?: 'CRYPTO' | 'FOREX' | 'FUTURES' | 'COMMODITIES';
  sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  title: string;
  content: string;
  media_url?: string | null;
  media_poster?: string | null;
  duration?: string | null;
  chapters?: Chapter[];
  setup_score?: number;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  risk_reward?: string;
  strategy_blueprint?: StrategyBlueprint;
  likes_count: number;
  liked_by_me?: boolean;
  comments: Comment[];
  is_bookmarked?: boolean;
}

interface NewsItem {
  id: string;
  headline: string;
  impact: 'HIGH' | 'MED' | 'LOW';
  category: string;
  time: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

const INITIAL_NEWS: NewsItem[] = [
  {
    id: 'n-1',
    headline: 'US Core PCE Price Index prints at 2.6% YoY vs 2.7% expected — Risk assets and crypto surge across desks.',
    impact: 'HIGH',
    category: 'MACRO',
    time: '3m ago',
    sentiment: 'BULLISH',
  },
  {
    id: 'n-2',
    headline: 'Binance BTCUSDT 15m order book prints massive 3.8x volume spike above $68,200 breakout pivot.',
    impact: 'HIGH',
    category: 'CRYPTO',
    time: '8m ago',
    sentiment: 'BULLISH',
  },
  {
    id: 'n-3',
    headline: 'ECB hints at another 25bps rate cut; EURUSD retests Asian session liquidity pool at 1.0820.',
    impact: 'MED',
    category: 'FOREX',
    time: '14m ago',
    sentiment: 'NEUTRAL',
  },
  {
    id: 'n-4',
    headline: 'CME FedWatch: Benchmark interest rate reduction probability climbs to 84.5% for upcoming FOMC.',
    impact: 'HIGH',
    category: 'MACRO',
    time: '22m ago',
    sentiment: 'BULLISH',
  },
  {
    id: 'n-5',
    headline: 'Gold Spot contracts break all-time high resistance on institutional central-bank sovereign bids.',
    impact: 'MED',
    category: 'COMMODITIES',
    time: '35m ago',
    sentiment: 'BULLISH',
  },
];

const INITIAL_POSTS: Post[] = [
  {
    id: 'post-vlog-btc-01',
    author: 'Marcus Chen, CFA',
    author_handle: 'marcus_quant',
    author_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&q=80',
    author_badge: '🏆 Top 1% Sharpe (2.84)',
    created_at: '18 minutes ago',
    post_type: 'vlog',
    symbol: 'BTCUSDT',
    asset_class: 'CRYPTO',
    sentiment: 'BULLISH',
    title: '📹 [Vlog] Week 43 Quant Session: Trading the BTC $68k Liquidity Sweep with PRISM',
    content:
      "Full video walkthrough of this morning's live execution on BTCUSDT. I dissect how the 5m EMA20 > EMA50 trend guard filtered out the initial choppy noise, how our 1.5R target filled in 14 minutes, and how the ATR trailing stop automatically protected $2,400 of unrealized profit when momentum stalled.",
    media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    media_poster: 'https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=1200&q=80',
    duration: '06:42',
    chapters: [
      { time: '00:45', title: 'Macro Liquidity Sweep & HTF Bias' },
      { time: '02:15', title: 'PRISM 5m Breakout Setup Confirmation' },
      { time: '04:30', title: 'Dynamic 1.5R Scaling & Trailing Stop Exit' },
    ],
    setup_score: 91,
    entry_price: 67850.0,
    target_price: 69200.0,
    stop_loss: 67320.0,
    risk_reward: '1 : 2.5',
    likes_count: 64,
    liked_by_me: false,
    comments: [
      {
        id: 'c1',
        author: 'Elena Rostova',
        author_handle: 'elena_algo',
        author_badge: '⚡ Prop Funded ($200k)',
        created_at: '12m ago',
        text: 'Great walkthrough Marcus. Did you tighten your ATR multiplier from 2.0 to 1.5 before the New York open?',
      },
      {
        id: 'c2',
        author: 'Marcus Chen, CFA',
        author_handle: 'marcus_quant',
        author_badge: 'Author',
        created_at: '8m ago',
        text: 'Yes exactly, during high-volatility sessions I ratchet ATR down to 1.5x after Target 1 fills to lock in the runner.',
      },
    ],
  },
  {
    id: 'post-signal-eur-02',
    author: 'Sarah Jenkins',
    author_handle: 'fx_sarah',
    author_avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=120&q=80',
    author_badge: '🛡️ Verified Prop Trader',
    created_at: '34 minutes ago',
    post_type: 'news_signal',
    symbol: 'EURUSD',
    asset_class: 'FOREX',
    sentiment: 'BULLISH',
    title: '📡 Real-Time Signal: EURUSD Asian Low Sweep Engulfing Setup',
    content:
      'ECB policy commentary triggered European sovereign bond yield stabilization. EURUSD swept Asian session liquidity at 1.0815 and printed a clean bullish engulfing candle on the 15m timeframe. High volume delta absorption confirmed across futures order books.',
    setup_score: 93,
    entry_price: 1.0828,
    target_price: 1.0885,
    stop_loss: 1.0798,
    risk_reward: '1 : 2.0',
    likes_count: 82,
    liked_by_me: false,
    comments: [
      {
        id: 'c3',
        author: 'David K.',
        author_handle: 'david_fx',
        author_badge: 'Quant Member',
        created_at: '20m ago',
        text: 'Taking this on paper trading right now! Risking 0.5% with stop at 1.0798.',
      },
    ],
  },
  {
    id: 'post-strat-nq-03',
    author: 'Dr. Nikolai Vance',
    author_handle: 'nikolai_quant',
    author_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
    author_badge: '🧠 Lead Quant Architect',
    created_at: '1 hour ago',
    post_type: 'strategy',
    symbol: 'NQ / ES',
    asset_class: 'FUTURES',
    sentiment: 'NEUTRAL',
    title: '💡 Institutional Strategy: Statistical Arbitrage Spread Cointegration (NQ vs ES)',
    content:
      'Deploying our synthetic spread model Spread_t = NQ_t - 1.28 * ES_t. Rolling 20-day Z-Score has expanded to +2.74 standard deviations due to tech sector earnings concentration. Ready for automated execution using Quant OS v3 AST rules.',
    strategy_blueprint: {
      name: 'AST Stat-Arb Cointegration Spread v3',
      sharpe_ratio: 2.38,
      win_rate_pct: 72.4,
      max_drawdown_pct: 4.2,
      rules_summary: 'Short NQ / Long ES when Z-Score > 2.5; Exit when Z-Score crosses zero.',
    },
    likes_count: 139,
    liked_by_me: false,
    comments: [
      {
        id: 'c4',
        author: 'QuantLab_HK',
        author_handle: 'quantlab_hk',
        author_badge: 'Institutional Tier',
        created_at: '45m ago',
        text: 'Fascinating beta calibration. How frequently do you recalculate the rolling cointegration vector?',
      },
      {
        id: 'c5',
        author: 'Dr. Nikolai Vance',
        author_handle: 'nikolai_quant',
        author_badge: 'Author',
        created_at: '30m ago',
        text: 'We recalculate beta daily at 00:00 UTC using a 60-day Johansen test lookback.',
      },
    ],
  },
  {
    id: 'post-vlog-prop-04',
    author: "Liam 'Apex' Taylor",
    author_handle: 'apex_trades',
    author_avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80',
    author_badge: '⚡ Funded $300k Trader',
    created_at: '2 hours ago',
    post_type: 'vlog',
    symbol: 'SOLUSDT',
    asset_class: 'CRYPTO',
    sentiment: 'BULLISH',
    title: '📹 [Vlog] Passing Prop Challenge in 10 Days: How Peak Trailing Drawdown Protected Capital',
    content:
      'Recorded my actual screen during verification day 10. Here is how strictly obeying the Intraday Peak Trailing Drawdown floor and never exceeding 0.75% risk allowed us to clear the target without emotional panic or overtrading.',
    media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    media_poster: 'https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=1200&q=80',
    duration: '09:12',
    chapters: [
      { time: '00:30', title: 'The Danger of Drawdown Floors in Prop Challenges' },
      { time: '03:15', title: 'Setting C++ RiskManager Intraday Floor' },
      { time: '06:40', title: 'Executing the Final 3.0R Winner' },
    ],
    setup_score: 88,
    entry_price: 181.2,
    target_price: 194.5,
    stop_loss: 177.0,
    likes_count: 97,
    liked_by_me: false,
    comments: [],
  },
  {
    id: 'post-signal-gold-05',
    author: 'Macro Quant Dispatch',
    author_handle: 'macro_dispatch',
    author_avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&q=80',
    author_badge: '🏛️ Macro Research',
    created_at: '3 hours ago',
    post_type: 'news_signal',
    symbol: 'GC (GOLD)',
    asset_class: 'COMMODITIES',
    sentiment: 'BULLISH',
    title: '📡 Breaking Signal: Spot Gold All-Time High Volatility Expansion',
    content:
      'Central bank sovereign reserve accumulation and real rate compression triggered a massive resistance breakout on Gold futures. Momentum indicators indicate institutional accumulation above key pivot.',
    setup_score: 95,
    entry_price: 2735.0,
    target_price: 2780.0,
    stop_loss: 2715.0,
    risk_reward: '1 : 2.25',
    likes_count: 115,
    liked_by_me: false,
    comments: [],
  },
];

export default function AlphaFeedPage() {
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [news, setNews] = useState<NewsItem[]>(INITIAL_NEWS);
  const [activeTab, setActiveTab] = useState<'ALL' | 'VLOG' | 'NEWS_SIGNAL' | 'STRATEGY' | 'TRENDING'>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [sentimentFilter, setSentimentFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isComposeOpen, setIsComposeOpen] = useState<boolean>(false);
  const [expandedComments, setExpandedComments] = useState<{ [postId: string]: boolean }>({});
  const [commentInputs, setCommentInputs] = useState<{ [postId: string]: string }>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New post form state
  const [formPostType, setFormPostType] = useState<'vlog' | 'news_signal' | 'strategy'>('news_signal');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formContent, setFormContent] = useState<string>('');
  const [formSymbol, setFormSymbol] = useState<string>('BTCUSDT');
  const [formSentiment, setFormSentiment] = useState<'BULLISH' | 'BEARISH' | 'NEUTRAL'>('BULLISH');
  const [formEntry, setFormEntry] = useState<string>('');
  const [formTarget, setFormTarget] = useState<string>('');
  const [formStop, setFormStop] = useState<string>('');
  const [formScore, setFormScore] = useState<number>(90);
  const [formMediaUrl, setFormMediaUrl] = useState<string>('');
  const [formVideoFile, setFormVideoFile] = useState<File | null>(null);
  const [videoPreviewBlob, setVideoPreviewBlob] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string>('Pro Quant Trader');
  const [authorHandle, setAuthorHandle] = useState<string>('pro_quant');

  // Load from API on mount with localStorage caching
  useEffect(() => {
    const saved = localStorage.getItem('quanteinstein_alpha_posts');
    if (saved) {
      try {
        setPosts(JSON.parse(saved));
      } catch (e) {
        // use initial
      }
    }

    // Try fetching latest from API
    fetch('http://127.0.0.1:8000/community/feed')
      .then(res => res.json())
      .then(data => {
        if (data && data.posts && data.posts.length > 0) {
          setPosts(data.posts);
          localStorage.setItem('quanteinstein_alpha_posts', JSON.stringify(data.posts));
        }
      })
      .catch(() => {
        // offline or local mock is fine
      });

    fetch('http://127.0.0.1:8000/community/news')
      .then(res => res.json())
      .then(data => {
        if (data && data.news && data.news.length > 0) {
          setNews(data.news);
        }
      })
      .catch(() => {});
  }, []);

  // Save to localStorage whenever posts change
  const updatePostsState = (newPosts: Post[]) => {
    setPosts(newPosts);
    try {
      localStorage.setItem('quanteinstein_alpha_posts', JSON.stringify(newPosts));
    } catch (e) {}
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Like handler
  const handleLike = (postId: string) => {
    const updated = posts.map(p => {
      if (p.id === postId) {
        const isLiked = p.liked_by_me;
        return {
          ...p,
          liked_by_me: !isLiked,
          likes_count: isLiked ? Math.max(0, p.likes_count - 1) : p.likes_count + 1,
        };
      }
      return p;
    });
    updatePostsState(updated);

    // Call API optimistically
    fetch(`http://127.0.0.1:8000/community/posts/${postId}/like`, { method: 'POST' }).catch(() => {});
  };

  // Toggle comments
  const toggleComments = (postId: string) => {
    setExpandedComments(prev => ({ ...prev, [postId]: !prev[postId] }));
  };

  // Submit comment
  const handleAddComment = (postId: string) => {
    const text = (commentInputs[postId] || '').trim();
    if (!text) return;

    const newComment: Comment = {
      id: `c-${Date.now()}`,
      author: authorName || 'Trader',
      author_handle: authorHandle || 'trader',
      author_badge: 'Quant Member',
      created_at: 'Just now',
      text,
    };

    const updated = posts.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          comments: [...(p.comments || []), newComment],
        };
      }
      return p;
    });

    updatePostsState(updated);
    setCommentInputs(prev => ({ ...prev, [postId]: '' }));
    showToast('Comment posted successfully!');

    fetch(`http://127.0.0.1:8000/community/posts/${postId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: authorName, author_handle: authorHandle, text }),
    }).catch(() => {});
  };

  // Handle local video file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFormVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoPreviewBlob(url);
    }
  };

  // Handle post publish
  const handleCreatePost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim()) {
      alert('Please provide a title and analysis description.');
      return;
    }

    const newPost: Post = {
      id: `post-${Date.now()}`,
      author: authorName || 'Pro Quant Trader',
      author_handle: authorHandle || 'pro_quant',
      author_avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&q=80',
      author_badge: '⚡ Verified Quant',
      created_at: 'Just now',
      post_type: formPostType,
      symbol: formSymbol.toUpperCase(),
      asset_class: formSymbol.includes('USD') && !formSymbol.includes('USDT') ? 'FOREX' : 'CRYPTO',
      sentiment: formSentiment,
      title: formTitle,
      content: formContent,
      media_url: videoPreviewBlob || formMediaUrl || null,
      media_poster: formPostType === 'vlog' ? 'https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=1200&q=80' : null,
      duration: formPostType === 'vlog' ? '05:30' : undefined,
      setup_score: formScore,
      entry_price: formEntry ? parseFloat(formEntry) : undefined,
      target_price: formTarget ? parseFloat(formTarget) : undefined,
      stop_loss: formStop ? parseFloat(formStop) : undefined,
      risk_reward: formEntry && formTarget && formStop ? '1 : 2.2' : undefined,
      likes_count: 1,
      liked_by_me: true,
      comments: [],
    };

    updatePostsState([newPost, ...posts]);
    setIsComposeOpen(false);
    setFormTitle('');
    setFormContent('');
    setFormEntry('');
    setFormTarget('');
    setFormStop('');
    setFormMediaUrl('');
    setFormVideoFile(null);
    setVideoPreviewBlob(null);
    showToast('Alpha published to community feed!');

    fetch('http://127.0.0.1:8000/community/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newPost.title,
        content: newPost.content,
        post_type: newPost.post_type,
        symbol: newPost.symbol,
        sentiment: newPost.sentiment,
        media_url: newPost.media_url,
        entry_price: newPost.entry_price,
        target_price: newPost.target_price,
        stop_loss: newPost.stop_loss,
        setup_score: newPost.setup_score,
        author: newPost.author,
        author_handle: newPost.author_handle,
      }),
    }).catch(() => {});
  };

  // Filtered posts
  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      // Tab filter
      if (activeTab === 'VLOG' && post.post_type !== 'vlog') return false;
      if (activeTab === 'NEWS_SIGNAL' && post.post_type !== 'news_signal') return false;
      if (activeTab === 'STRATEGY' && post.post_type !== 'strategy') return false;
      if (activeTab === 'TRENDING' && post.likes_count < 80) return false;

      // Symbol filter
      if (symbolFilter !== 'ALL' && !post.symbol.toLowerCase().includes(symbolFilter.toLowerCase())) return false;

      // Sentiment filter
      if (sentimentFilter !== 'ALL' && post.sentiment !== sentimentFilter) return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = post.title.toLowerCase().includes(q);
        const matchesContent = post.content.toLowerCase().includes(q);
        const matchesAuthor = post.author.toLowerCase().includes(q) || post.author_handle.toLowerCase().includes(q);
        const matchesSymbol = post.symbol.toLowerCase().includes(q);
        if (!matchesTitle && !matchesContent && !matchesAuthor && !matchesSymbol) return false;
      }

      return true;
    });
  }, [posts, activeTab, symbolFilter, sentimentFilter, searchQuery]);

  return (
    <div style={{ maxWidth: 1380, margin: '0 auto', paddingBottom: 60 }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 10,
            fontWeight: 700,
            boxShadow: '0 10px 25px rgba(16, 185, 129, 0.4)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>✓</span> {toastMessage}
        </div>
      )}

      {/* 🔴 Top Breaking Real-time News Marquee Banner */}
      <div
        style={{
          background: 'linear-gradient(90deg, #1e1b4b 0%, #0f172a 100%)',
          borderBottom: '1px solid rgba(99, 102, 241, 0.3)',
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          overflow: 'hidden',
          fontSize: 13,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            color: '#fca5a5',
            padding: '3px 8px',
            borderRadius: 6,
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
          BREAKING SIGNALS
        </div>

        <div style={{ display: 'flex', gap: 24, overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'none', flex: 1 }}>
          {news.map(item => (
            <div key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  color: item.sentiment === 'BULLISH' ? '#86efac' : item.sentiment === 'BEARISH' ? '#fca5a5' : '#cbd5e1',
                  fontWeight: 600,
                }}
              >
                [{item.category}]
              </span>
              <span style={{ color: '#e2e8f0' }}>{item.headline}</span>
              <span style={{ color: '#64748b', fontSize: 11 }}>({item.time})</span>
              <span style={{ color: '#334155' }}>•</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hero Header */}
      <div className="hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span
              style={{
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                color: '#a5b4fc',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              📡 TRADER SOCIAL & ALPHA HUB
            </span>
            <span style={{ color: '#64748b', fontSize: 12 }}>• Real-Time Feeds & Interactive Vlogs</span>
          </div>
          <h1>Alpha Feed • Signals, Trader Vlogs & Strategy Ideas</h1>
          <p className="muted" style={{ maxWidth: 840, fontSize: 14 }}>
            Community alpha hub for retail quants and prop-firm traders. Watch live trade vlogs, inspect verified breakout signals, discuss market
            structure, like, comment, and deploy ideas directly to the paper execution engine.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={() => setIsComposeOpen(!isComposeOpen)}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#ffffff',
              padding: '10px 20px',
              borderRadius: 10,
              fontWeight: 700,
              boxShadow: '0 4px 18px rgba(99, 102, 241, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span>{isComposeOpen ? '✕ Close Composer' : '+ Share Alpha / Upload Vlog'}</span>
          </button>
        </div>
      </div>

      {/* Quick Stats Counter Bar */}
      <div style={{ padding: '0 24px', marginBottom: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          <div className="kpi-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28 }}>📡</div>
            <div>
              <div className="kpi-label">Active Signals Today</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#86efac' }}>14 Bullish • 5 Bearish</div>
            </div>
          </div>

          <div className="kpi-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28 }}>📹</div>
            <div>
              <div className="kpi-label">Community Vlogs</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#a5b4fc' }}>32 Video Recaps</div>
            </div>
          </div>

          <div className="kpi-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28 }}>👥</div>
            <div>
              <div className="kpi-label">Quants Online</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8' }}>148 Active Traders</div>
            </div>
          </div>

          <div className="kpi-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28 }}>⚡</div>
            <div>
              <div className="kpi-label">Macro Sentiment</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#facc15' }}>68 • Greed (Risk-On)</div>
            </div>
          </div>
        </div>
      </div>

      {/* 📝 Expandable "Upload Vlog / Post Signal" Composer Modal / Accordion */}
      {isComposeOpen && (
        <div className="card" style={{ border: '1px solid rgba(99, 102, 241, 0.45)', background: '#131b2e', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🚀</span> Share Quantitative Alpha with the Community
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setFormPostType('news_signal')}
                style={{
                  background: formPostType === 'news_signal' ? '#6366f1' : '#1e293b',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                📡 News Signal
              </button>
              <button
                type="button"
                onClick={() => setFormPostType('vlog')}
                style={{
                  background: formPostType === 'vlog' ? '#6366f1' : '#1e293b',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                📹 Trader Vlog / Video
              </button>
              <button
                type="button"
                onClick={() => setFormPostType('strategy')}
                style={{
                  background: formPostType === 'strategy' ? '#6366f1' : '#1e293b',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                💡 Strategy Idea
              </button>
            </div>
          </div>

          <form onSubmit={handleCreatePost}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Post Title</label>
                <input
                  type="text"
                  placeholder="e.g., BTCUSDT 15m Breakout: Clean Liquidity Grab & 1.5R Retest"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Market Symbol</label>
                <select value={formSymbol} onChange={e => setFormSymbol(e.target.value)}>
                  <option value="BTCUSDT">BTCUSDT [CRYPTO]</option>
                  <option value="ETHUSDT">ETHUSDT [CRYPTO]</option>
                  <option value="SOLUSDT">SOLUSDT [CRYPTO]</option>
                  <option value="EURUSD">EURUSD [FOREX]</option>
                  <option value="GBPUSD">GBPUSD [FOREX]</option>
                  <option value="NQ / ES">NQ / ES [FUTURES]</option>
                  <option value="GC (GOLD)">GC (GOLD) [COMMODITIES]</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Market Direction / Sentiment</label>
                <select value={formSentiment} onChange={e => setFormSentiment(e.target.value as any)}>
                  <option value="BULLISH">🟢 Bullish / Long</option>
                  <option value="BEARISH">🔴 Bearish / Short</option>
                  <option value="NEUTRAL">⚪ Neutral / Mean Reversion</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Your Trader Handle</label>
                <input
                  type="text"
                  placeholder="@your_handle"
                  value={authorHandle}
                  onChange={e => setAuthorHandle(e.target.value)}
                />
              </div>
            </div>

            {/* Signal specific inputs */}
            {formPostType === 'news_signal' && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                  marginBottom: 14,
                  background: 'rgba(99, 102, 241, 0.08)',
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                }}
              >
                <div>
                  <label style={{ fontSize: 11, color: '#a5b4fc', display: 'block', marginBottom: 2 }}>Entry Price Zone</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 67800"
                    value={formEntry}
                    onChange={e => setFormEntry(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#86efac', display: 'block', marginBottom: 2 }}>Target Price (Take Profit)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 69200"
                    value={formTarget}
                    onChange={e => setFormTarget(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#fca5a5', display: 'block', marginBottom: 2 }}>Stop Loss Price</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 67250"
                    value={formStop}
                    onChange={e => setFormStop(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#fde047', display: 'block', marginBottom: 2 }}>Setup Score: {formScore}/100</label>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    value={formScore}
                    onChange={e => setFormScore(parseInt(e.target.value))}
                    style={{ marginTop: 8 }}
                  />
                </div>
              </div>
            )}

            {/* Vlog Video Upload & Preview */}
            {formPostType === 'vlog' && (
              <div
                style={{
                  marginBottom: 14,
                  background: 'rgba(56, 189, 248, 0.08)',
                  padding: 14,
                  borderRadius: 10,
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700, display: 'block', marginBottom: 4 }}>
                      📹 Upload Local Video File (MP4, WebM, MOV)
                    </label>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/ogg,video/quicktime"
                      onChange={handleFileChange}
                      style={{ padding: '8px 10px', fontSize: 12, background: '#090e17' }}
                    />
                    <p style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      Instant browser preview. Traders can watch your video directly in the community feed.
                    </p>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                      Or Paste Video URL (YouTube, Vimeo, Loom, or MP4 link)
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/video.mp4 or YouTube link"
                      value={formMediaUrl}
                      onChange={e => setFormMediaUrl(e.target.value)}
                    />
                  </div>
                </div>

                {/* Instant Video Player Preview */}
                {(videoPreviewBlob || formMediaUrl) && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600, marginBottom: 4 }}>
                      ▶ Video Player Preview:
                    </div>
                    <div style={{ maxHeight: 220, borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                      <video
                        src={videoPreviewBlob || formMediaUrl}
                        controls
                        style={{ width: '100%', maxHeight: 220, objectFit: 'contain' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Analysis Text Body */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                Quantitative Thesis & Trade Analysis
              </label>
              <textarea
                rows={4}
                placeholder="Explain the setup rationale: indicators, liquidity sweeps, HTF EMA alignment, risk management rules, and execution discipline..."
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setIsComposeOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                  fontWeight: 700,
                }}
              >
                🚀 Publish Alpha Post
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Grid: Feed on Left + Intelligence Radar on Right */}
      <div style={{ padding: '0 24px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 24 }}>
        {/* Left Column: Filter Bar & Feed Stream */}
        <div>
          {/* Filter Bar */}
          <div
            style={{
              background: '#111827',
              border: '1px solid #243044',
              borderRadius: 14,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            {/* Category Tabs */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {[
                { id: 'ALL', label: '🌟 All Alpha' },
                { id: 'NEWS_SIGNAL', label: '📡 News Signals' },
                { id: 'VLOG', label: '📹 Trader Vlogs' },
                { id: 'STRATEGY', label: '💡 Strategy Ideas' },
                { id: 'TRENDING', label: '🔥 Top Trending' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  style={{
                    background: activeTab === tab.id ? '#6366f1' : 'transparent',
                    color: activeTab === tab.id ? '#ffffff' : '#94a3b8',
                    border: activeTab === tab.id ? '1px solid #818cf8' : '1px solid transparent',
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: activeTab === tab.id ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Quick Filters */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={symbolFilter}
                onChange={e => setSymbolFilter(e.target.value)}
                style={{ width: 'auto', padding: '6px 10px', fontSize: 12, height: 34 }}
              >
                <option value="ALL">All Symbols</option>
                <option value="BTCUSDT">BTCUSDT</option>
                <option value="ETHUSDT">ETHUSDT</option>
                <option value="SOLUSDT">SOLUSDT</option>
                <option value="EURUSD">EURUSD</option>
                <option value="NQ">NQ / ES</option>
                <option value="GOLD">Gold (GC)</option>
              </select>

              <select
                value={sentimentFilter}
                onChange={e => setSentimentFilter(e.target.value)}
                style={{ width: 'auto', padding: '6px 10px', fontSize: 12, height: 34 }}
              >
                <option value="ALL">All Sentiments</option>
                <option value="BULLISH">🟢 Bullish</option>
                <option value="BEARISH">🔴 Bearish</option>
                <option value="NEUTRAL">⚪ Neutral</option>
              </select>

              <input
                type="text"
                placeholder="Search alpha, quants..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ width: 170, padding: '6px 10px', fontSize: 12, height: 34 }}
              />
            </div>
          </div>

          {/* Posts Stream */}
          {filteredPosts.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>No Alpha Found</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                No community signals or vlogs match your active filter criteria. Try resetting your search or share your own!
              </p>
              <button
                onClick={() => {
                  setActiveTab('ALL');
                  setSymbolFilter('ALL');
                  setSentimentFilter('ALL');
                  setSearchQuery('');
                }}
                style={{ marginTop: 14 }}
              >
                Reset Filters
              </button>
            </div>
          ) : (
            filteredPosts.map(post => (
              <article
                key={post.id}
                className="card"
                style={{
                  margin: '0 0 16px 0',
                  padding: 20,
                  border: '1px solid #243044',
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Post Top Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img
                      src={post.author_avatar}
                      alt={post.author}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: '2px solid rgba(99, 102, 241, 0.4)',
                      }}
                    />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: '#f8fafc' }}>{post.author}</span>
                        <span style={{ color: '#64748b', fontSize: 13 }}>@{post.author_handle}</span>
                        {post.author_badge && (
                          <span
                            style={{
                              background: 'rgba(99, 102, 241, 0.16)',
                              color: '#a5b4fc',
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 6,
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                            }}
                          >
                            {post.author_badge}
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{post.created_at}</div>
                    </div>
                  </div>

                  {/* Pills */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span
                      style={{
                        background:
                          post.post_type === 'vlog'
                            ? 'rgba(56, 189, 248, 0.15)'
                            : post.post_type === 'news_signal'
                            ? 'rgba(34, 197, 94, 0.15)'
                            : 'rgba(168, 85, 247, 0.15)',
                        color:
                          post.post_type === 'vlog'
                            ? '#38bdf8'
                            : post.post_type === 'news_signal'
                            ? '#86efac'
                            : '#c084fc',
                        border: '1px solid currentColor',
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                      }}
                    >
                      {post.post_type === 'vlog' ? '📹 Vlog' : post.post_type === 'news_signal' ? '📡 Signal' : '💡 Strategy'}
                    </span>

                    <span
                      style={{
                        background: '#0f172a',
                        border: '1px solid #334155',
                        color: '#cbd5e1',
                        padding: '3px 8px',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {post.symbol}
                    </span>

                    {post.sentiment && (
                      <span
                        style={{
                          background:
                            post.sentiment === 'BULLISH'
                              ? 'rgba(34, 197, 94, 0.15)'
                              : post.sentiment === 'BEARISH'
                              ? 'rgba(239, 68, 68, 0.15)'
                              : 'rgba(148, 163, 184, 0.15)',
                          color:
                            post.sentiment === 'BULLISH'
                              ? '#86efac'
                              : post.sentiment === 'BEARISH'
                              ? '#fca5a5'
                              : '#cbd5e1',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {post.sentiment === 'BULLISH' ? '🟢 Bullish' : post.sentiment === 'BEARISH' ? '🔴 Bearish' : '⚪ Neutral'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Post Title & Text */}
                <h3 style={{ fontSize: 17, color: '#f8fafc', marginBottom: 8, lineHeight: 1.35 }}>{post.title}</h3>
                <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, marginBottom: 14 }}>{post.content}</p>

                {/* 📹 Trader Vlog Video Player Component */}
                {post.post_type === 'vlog' && post.media_url && (
                  <div
                    style={{
                      marginBottom: 16,
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#000',
                      border: '1px solid #1e293b',
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <video
                        src={post.media_url}
                        controls
                        poster={post.media_poster || undefined}
                        style={{ width: '100%', maxHeight: 380, background: '#000', display: 'block' }}
                      />
                      {post.duration && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 12,
                            right: 12,
                            background: 'rgba(0, 0, 0, 0.75)',
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          📹 {post.duration}
                        </div>
                      )}
                    </div>

                    {/* Chapters Breakdown */}
                    {post.chapters && post.chapters.length > 0 && (
                      <div
                        style={{
                          background: '#090e17',
                          padding: '8px 14px',
                          borderTop: '1px solid #1e293b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          overflowX: 'auto',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#94a3b8', fontWeight: 600 }}>Chapters:</span>
                        {post.chapters.map(c => (
                          <span
                            key={c.time}
                            style={{
                              background: '#131b2e',
                              border: '1px solid #23314d',
                              padding: '2px 8px',
                              borderRadius: 4,
                              color: '#a5b4fc',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span style={{ color: '#38bdf8', fontWeight: 700 }}>{c.time}</span> {c.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 📡 Signal Parameters Card */}
                {post.post_type === 'news_signal' && post.entry_price && (
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      borderRadius: 12,
                      padding: '12px 16px',
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Entry Zone</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{post.entry_price}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 11, color: '#86efac', textTransform: 'uppercase' }}>Target 1 (1.5R)</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#86efac' }}>{post.target_price}</div>
                        </div>

                        <div>
                          <div style={{ fontSize: 11, color: '#fca5a5', textTransform: 'uppercase' }}>Stop Loss</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#fca5a5' }}>{post.stop_loss}</div>
                        </div>

                        {post.setup_score && (
                          <div>
                            <div style={{ fontSize: 11, color: '#facc15', textTransform: 'uppercase' }}>Setup Score</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#facc15' }}>{post.setup_score} / 100</div>
                          </div>
                        )}
                      </div>

                      <Link
                        href={`/paper-trading?symbol=${post.symbol}`}
                        style={{
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: '#fff',
                          textDecoration: 'none',
                          padding: '7px 14px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          boxShadow: '0 2px 10px rgba(16, 185, 129, 0.25)',
                        }}
                      >
                        <span>🚀</span> Execute in Paper Trading →
                      </Link>
                    </div>
                  </div>
                )}

                {/* 💡 Strategy Blueprint Card */}
                {post.post_type === 'strategy' && post.strategy_blueprint && (
                  <div
                    style={{
                      background: 'rgba(168, 85, 247, 0.08)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      borderRadius: 12,
                      padding: '12px 16px',
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#e9d5ff' }}>
                          Blueprint: {post.strategy_blueprint.name}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                          Sharpe: <strong style={{ color: '#86efac' }}>{post.strategy_blueprint.sharpe_ratio}</strong> • Win Rate:{' '}
                          <strong style={{ color: '#38bdf8' }}>{post.strategy_blueprint.win_rate_pct}%</strong> • Max DD:{' '}
                          <strong style={{ color: '#fca5a5' }}>{post.strategy_blueprint.max_drawdown_pct}%</strong>
                        </div>
                      </div>

                      <Link
                        href="/strategy-builder"
                        style={{
                          background: 'rgba(168, 85, 247, 0.2)',
                          color: '#d8b4fe',
                          border: '1px solid rgba(168, 85, 247, 0.5)',
                          textDecoration: 'none',
                          padding: '7px 14px',
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        ⚙️ Import to Strategy Builder →
                      </Link>
                    </div>
                  </div>
                )}

                {/* Social Interaction Bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: '1px solid #1e293b',
                    paddingTop: 12,
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    {/* Like button */}
                    <button
                      onClick={() => handleLike(post.id)}
                      style={{
                        background: post.liked_by_me ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                        color: post.liked_by_me ? '#ef4444' : '#94a3b8',
                        border: post.liked_by_me ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid #29364f',
                        padding: '6px 14px',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <span>{post.liked_by_me ? '❤️' : '🤍'}</span>
                      <span style={{ fontWeight: 700 }}>{post.likes_count}</span>
                    </button>

                    {/* Comments button */}
                    <button
                      onClick={() => toggleComments(post.id)}
                      style={{
                        background: 'transparent',
                        color: '#94a3b8',
                        border: '1px solid #29364f',
                        padding: '6px 14px',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                      }}
                    >
                      <span>💬</span>
                      <span>Comments ({post.comments ? post.comments.length : 0})</span>
                    </button>

                    {/* Share Button */}
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(window.location.href);
                        showToast('Link copied to clipboard!');
                      }}
                      style={{
                        background: 'transparent',
                        color: '#94a3b8',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        padding: '6px 10px',
                      }}
                    >
                      <span>🔗</span> Share
                    </button>
                  </div>
                </div>

                {/* 💬 Comments Drawer */}
                {expandedComments[post.id] && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      background: '#090e17',
                      borderRadius: 10,
                      border: '1px solid #1e293b',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', marginBottom: 12 }}>
                      Discussion ({post.comments ? post.comments.length : 0})
                    </div>

                    {/* Comments List */}
                    {post.comments && post.comments.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                        {post.comments.map(c => (
                          <div
                            key={c.id}
                            style={{
                              background: '#111827',
                              padding: '10px 14px',
                              borderRadius: 8,
                              border: '1px solid #1f293d',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 13 }}>{c.author}</span>
                                <span style={{ color: '#64748b', fontSize: 11 }}>@{c.author_handle}</span>
                                {c.author_badge && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      background: 'rgba(99, 102, 241, 0.1)',
                                      color: '#818cf8',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                    }}
                                  >
                                    {c.author_badge}
                                  </span>
                                )}
                              </div>
                              <span style={{ color: '#64748b', fontSize: 11 }}>{c.created_at}</span>
                            </div>
                            <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0 }}>{c.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
                        No comments yet. Start the quantitative discussion!
                      </div>
                    )}

                    {/* Add Comment Input */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        type="text"
                        placeholder="Add a comment, risk question, or feedback..."
                        value={commentInputs[post.id] || ''}
                        onChange={e => setCommentInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleAddComment(post.id);
                        }}
                        style={{ fontSize: 13 }}
                      />
                      <button
                        onClick={() => handleAddComment(post.id)}
                        style={{
                          background: '#6366f1',
                          padding: '8px 16px',
                          fontSize: 13,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        {/* Right Column: Market Radar, Leaderboard & Macro Catalysts */}
        <div>
          {/* Live Market Radar */}
          <div className="card" style={{ margin: '0 0 16px 0', padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📡</span> Live Market Radar
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              {[
                { symbol: 'BTCUSDT', price: '$68,420.50', chg: '+3.42%', up: true },
                { symbol: 'ETHUSDT', price: '$3,515.20', chg: '+2.18%', up: true },
                { symbol: 'SOLUSDT', price: '$182.40', chg: '+5.74%', up: true },
                { symbol: 'EURUSD', price: '1.0842', chg: '-0.14%', up: false },
                { symbol: 'NQ1! (Nasdaq)', price: '20,410.0', chg: '+1.02%', up: true },
                { symbol: 'GC (Gold)', price: '$2,738.5', chg: '+0.88%', up: true },
              ].map(m => (
                <div
                  key={m.symbol}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: '#090e17',
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#f1f5f9' }}>{m.symbol}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.price}</div>
                    <div style={{ color: m.up ? '#86efac' : '#fca5a5', fontSize: 11, fontWeight: 700 }}>{m.chg}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Community Quants Leaderboard */}
          <div className="card" style={{ margin: '0 0 16px 0', padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🏆</span> Top Community Quants
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
              {[
                { name: 'Marcus Chen, CFA', handle: '@marcus_quant', winRate: '74.2%', pf: '2.84', badge: 'Top 1% Sharpe' },
                { name: 'Sarah Jenkins', handle: '@fx_sarah', winRate: '68.5%', pf: '2.41', badge: 'Funded $200k' },
                { name: 'Dr. Nikolai Vance', handle: '@nikolai_quant', winRate: '71.0%', pf: '2.38', badge: 'Lead Architect' },
                { name: 'Elena Rostova', handle: '@elena_algo', winRate: '66.4%', pf: '2.15', badge: 'Prop Verified' },
              ].map((q, idx) => (
                <div key={q.handle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                      #{idx + 1} {q.name}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>
                      {q.handle} • {q.badge}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#86efac', fontWeight: 700, fontSize: 12 }}>PF {q.pf}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>WR {q.winRate}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming Economic Catalysts */}
          <div className="card" style={{ margin: '0 0 16px 0', padding: 18 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📅</span> Macro Catalysts (Week 43)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
              <div style={{ padding: '8px 10px', background: '#090e17', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f8fafc', fontWeight: 600 }}>
                  <span>US Non-Farm Payrolls (NFP)</span>
                  <span style={{ color: '#ef4444' }}>HIGH</span>
                </div>
                <div style={{ color: '#64748b', marginTop: 2 }}>Friday 12:30 UTC • Forecast 140k vs 254k prev</div>
              </div>

              <div style={{ padding: '8px 10px', background: '#090e17', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f8fafc', fontWeight: 600 }}>
                  <span>FOMC Interest Rate Decision</span>
                  <span style={{ color: '#ef4444' }}>HIGH</span>
                </div>
                <div style={{ color: '#64748b', marginTop: 2 }}>Wed 18:00 UTC • 25bps cut anticipated</div>
              </div>

              <div style={{ padding: '8px 10px', background: '#090e17', borderRadius: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f8fafc', fontWeight: 600 }}>
                  <span>Eurozone CPI Estimate</span>
                  <span style={{ color: '#facc15' }}>MED</span>
                </div>
                <div style={{ color: '#64748b', marginTop: 2 }}>Thursday 09:00 UTC • Forecast 1.8% YoY</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
