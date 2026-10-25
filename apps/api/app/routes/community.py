"""Community, trader vlogs, and real-time market signals router."""
from __future__ import annotations

import uuid
import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()

# In-memory store with persistent backing
_INITIAL_POSTS: List[Dict[str, Any]] = [
    {
        "id": "post-vlog-btc-01",
        "author": "Marcus Chen, CFA",
        "author_handle": "marcus_quant",
        "author_avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&q=80",
        "author_badge": "🏆 Top 1% Sharpe (2.84)",
        "created_at": "18 minutes ago",
        "timestamp_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "post_type": "vlog",
        "symbol": "BTCUSDT",
        "asset_class": "CRYPTO",
        "sentiment": "BULLISH",
        "title": "📹 [Vlog] Week 43 Quant Session: Trading the BTC $68k Liquidity Sweep with PRISM",
        "content": "Full video walkthrough of this morning's live execution on BTCUSDT. I dissect how the 5m EMA20 > EMA50 trend guard filtered out the initial choppy noise, how our 1.5R target filled in 14 minutes, and how the ATR trailing stop automatically protected $2,400 of unrealized profit when the momentum stalled.",
        "media_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        "media_poster": "https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=1200&q=80",
        "duration": "06:42",
        "chapters": [
            {"time": "00:45", "title": "Macro Liquidity Sweep & HTF Bias"},
            {"time": "02:15", "title": "PRISM 5m Breakout Setup Confirmation"},
            {"time": "04:30", "title": "Dynamic 1.5R Scaling & Trailing Stop Exit"}
        ],
        "setup_score": 91,
        "entry_price": 67850.0,
        "target_price": 69200.0,
        "stop_loss": 67320.0,
        "likes_count": 64,
        "liked_by_me": False,
        "comments": [
            {
                "id": "c1",
                "author": "Elena Rostova",
                "author_handle": "elena_algo",
                "author_badge": "⚡ Prop Funded ($200k)",
                "created_at": "12m ago",
                "text": "Great walkthrough Marcus. Did you tighten your ATR multiplier from 2.0 to 1.5 before the New York open?"
            },
            {
                "id": "c2",
                "author": "Marcus Chen, CFA",
                "author_handle": "marcus_quant",
                "author_badge": "Author",
                "created_at": "8m ago",
                "text": "Yes exactly, during high-volatility sessions I ratchet ATR down to 1.5x after Target 1 fills to lock in the runner."
            }
        ]
    },
    {
        "id": "post-signal-eur-02",
        "author": "Sarah Jenkins",
        "author_handle": "fx_sarah",
        "author_avatar": "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=120&q=80",
        "author_badge": "🛡️ Verified Prop Trader",
        "created_at": "34 minutes ago",
        "timestamp_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "post_type": "news_signal",
        "symbol": "EURUSD",
        "asset_class": "FOREX",
        "sentiment": "BULLISH",
        "title": "📡 Real-Time Signal: EURUSD Asian Low Sweep Engulfing Setup",
        "content": "ECB policy commentary triggered European sovereign bond yield stabilization. EURUSD swept Asian session liquidity at 1.0815 and printed a clean bullish engulfing candle on the 15m timeframe. High volume delta absorption confirmed across futures order books.",
        "media_url": None,
        "media_poster": None,
        "setup_score": 93,
        "entry_price": 1.0828,
        "target_price": 1.0885,
        "stop_loss": 1.0798,
        "risk_reward": "1 : 2.0",
        "likes_count": 82,
        "liked_by_me": False,
        "comments": [
            {
                "id": "c3",
                "author": "David K.",
                "author_handle": "david_fx",
                "author_badge": "Quant Member",
                "created_at": "20m ago",
                "text": "Taking this on paper trading right now! Risking 0.5% with stop at 1.0798."
            }
        ]
    },
    {
        "id": "post-strat-nq-03",
        "author": "Dr. Nikolai Vance",
        "author_handle": "nikolai_quant",
        "author_avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80",
        "author_badge": "🧠 Lead Quant Architect",
        "created_at": "1 hour ago",
        "timestamp_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "post_type": "strategy",
        "symbol": "NQ / ES",
        "asset_class": "FUTURES",
        "sentiment": "NEUTRAL",
        "title": "💡 Institutional Strategy: Statistical Arbitrage Spread Cointegration (NQ vs ES)",
        "content": "Deploying our synthetic spread model Spread_t = NQ_t - 1.28 * ES_t. Rolling 20-day Z-Score has expanded to +2.74 standard deviations due to tech sector earnings concentration. Ready for automated execution using Quant OS v3 AST rules.",
        "media_url": None,
        "media_poster": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&q=80",
        "strategy_blueprint": {
            "name": "AST Stat-Arb Cointegration Spread v3",
            "sharpe_ratio": 2.38,
            "win_rate_pct": 72.4,
            "max_drawdown_pct": 4.2,
            "rules_summary": "Short NQ / Long ES when Z-Score > 2.5; Exit when Z-Score crosses zero."
        },
        "likes_count": 139,
        "liked_by_me": False,
        "comments": [
            {
                "id": "c4",
                "author": "QuantLab_HK",
                "author_handle": "quantlab_hk",
                "author_badge": "Institutional Tier",
                "created_at": "45m ago",
                "text": "Fascinating beta calibration. How frequently do you recalculate the rolling cointegration vector?"
            },
            {
                "id": "c5",
                "author": "Dr. Nikolai Vance",
                "author_handle": "nikolai_quant",
                "author_badge": "Author",
                "created_at": "30m ago",
                "text": "We recalculate beta daily at 00:00 UTC using a 60-day Johansen test lookback."
            }
        ]
    },
    {
        "id": "post-vlog-prop-04",
        "author": "Liam 'Apex' Taylor",
        "author_handle": "apex_trades",
        "author_avatar": "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80",
        "author_badge": "⚡ Funded $300k Trader",
        "created_at": "2 hours ago",
        "timestamp_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "post_type": "vlog",
        "symbol": "SOLUSDT",
        "asset_class": "CRYPTO",
        "sentiment": "BULLISH",
        "title": "📹 [Vlog] Passing Prop Challenge in 10 Days: How Peak Trailing Drawdown Protected Capital",
        "content": "Recorded my actual screen during verification day 10. Here is how strictly obeying the Intraday Peak Trailing Drawdown floor and never exceeding 0.75% risk allowed us to clear the target without emotional panic or overtrading.",
        "media_url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        "media_poster": "https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=1200&q=80",
        "duration": "09:12",
        "chapters": [
            {"time": "00:30", "title": "The Danger of Drawdown Floors in Prop Challenges"},
            {"time": "03:15", "title": "Setting C++ RiskManager Intraday Floor"},
            {"time": "06:40", "title": "Executing the Final 3.0R Winner"}
        ],
        "setup_score": 88,
        "entry_price": 181.20,
        "target_price": 194.50,
        "stop_loss": 177.00,
        "likes_count": 97,
        "liked_by_me": False,
        "comments": []
    },
    {
        "id": "post-signal-gold-05",
        "author": "Macro Quant Dispatch",
        "author_handle": "macro_dispatch",
        "author_avatar": "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&q=80",
        "author_badge": "🏛️ Macro Research",
        "created_at": "3 hours ago",
        "timestamp_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "post_type": "news_signal",
        "symbol": "GC (GOLD)",
        "asset_class": "COMMODITIES",
        "sentiment": "BULLISH",
        "title": "📡 Breaking Signal: Spot Gold All-Time High Volatility Expansion",
        "content": "Central bank sovereign reserve accumulation and real rate compression triggered a massive resistance breakout on Gold futures. Momentum indicators indicate institutional accumulation above key pivot.",
        "setup_score": 95,
        "entry_price": 2735.0,
        "target_price": 2780.0,
        "stop_loss": 2715.0,
        "risk_reward": "1 : 2.25",
        "likes_count": 115,
        "liked_by_me": False,
        "comments": []
    }
]

# Fast in-memory state
_FEED_POSTS: List[Dict[str, Any]] = list(_INITIAL_POSTS)

_REALTIME_NEWS: List[Dict[str, Any]] = [
    {
        "id": "news-1",
        "headline": "US Core PCE Price Index prints 2.6% YoY vs 2.7% expected — Risk assets and crypto surge across desks.",
        "impact": "HIGH",
        "category": "MACRO",
        "time": "3m ago",
        "sentiment": "BULLISH"
    },
    {
        "id": "news-2",
        "headline": "Binance Spot BTCUSDT breaks $68,200 with 3.8x volume spike on 15m order book.",
        "impact": "HIGH",
        "category": "CRYPTO",
        "time": "7m ago",
        "sentiment": "BULLISH"
    },
    {
        "id": "news-3",
        "headline": "ECB policymaker hints at additional 25bps rate cut; EURUSD tests key liquidity pocket.",
        "impact": "MED",
        "category": "FOREX",
        "time": "14m ago",
        "sentiment": "NEUTRAL"
    },
    {
        "id": "news-4",
        "headline": "CME FedWatch Tool reports 84.2% probability of benchmark interest rate reduction.",
        "impact": "HIGH",
        "category": "MACRO",
        "time": "21m ago",
        "sentiment": "BULLISH"
    },
    {
        "id": "news-5",
        "headline": "Gold spot contracts reach record volume as institutional safe-haven demand accelerates.",
        "impact": "MED",
        "category": "COMMODITY",
        "time": "32m ago",
        "sentiment": "BULLISH"
    }
]


class CommentRequest(BaseModel):
    author: str = "Anonymous Quant"
    author_handle: str = "quant_trader"
    text: str = Field(..., min_length=1, max_length=1000)


class CreatePostRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    content: str = Field(..., min_length=5, max_length=5000)
    post_type: str = Field("news_signal", description="news_signal, vlog, strategy, or general")
    symbol: Optional[str] = "BTCUSDT"
    asset_class: Optional[str] = "CRYPTO"
    sentiment: Optional[str] = "BULLISH"
    media_url: Optional[str] = None
    media_poster: Optional[str] = None
    duration: Optional[str] = None
    entry_price: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    setup_score: Optional[int] = 85
    author: Optional[str] = "Pro Quant Trader"
    author_handle: Optional[str] = "pro_quant"
    author_badge: Optional[str] = "⚡ Verified Trader"


@router.get("/feed", summary="Get Community Alpha Feed & Trader Vlogs")
def get_feed(
    post_type: Optional[str] = Query(None, description="Filter by post type: vlog, news_signal, strategy"),
    symbol: Optional[str] = Query(None, description="Filter by asset symbol"),
    sentiment: Optional[str] = Query(None, description="Filter by sentiment: BULLISH, BEARISH, NEUTRAL")
):
    """Returns recent community posts, vlogs, news signals, and strategy ideas."""
    results = _FEED_POSTS
    if post_type and post_type.lower() != "all":
        results = [p for p in results if p.get("post_type", "").lower() == post_type.lower()]
    if symbol and symbol.lower() != "all":
        results = [p for p in results if symbol.lower() in p.get("symbol", "").lower()]
    if sentiment and sentiment.lower() != "all":
        results = [p for p in results if p.get("sentiment", "").lower() == sentiment.lower()]

    return {
        "status": "ok",
        "count": len(results),
        "posts": results
    }


@router.post("/posts", summary="Publish a new trader vlog, news signal, or strategy idea")
def create_post(payload: CreatePostRequest):
    """Publish a post into the community stream."""
    new_post: Dict[str, Any] = {
        "id": f"post-{uuid.uuid4().hex[:8]}",
        "author": payload.author or "Pro Quant Trader",
        "author_handle": payload.author_handle or "pro_quant",
        "author_avatar": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&q=80",
        "author_badge": payload.author_badge or "⚡ Community Quant",
        "created_at": "Just now",
        "timestamp_iso": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "post_type": payload.post_type,
        "symbol": (payload.symbol or "BTCUSDT").upper(),
        "asset_class": payload.asset_class or "CRYPTO",
        "sentiment": (payload.sentiment or "BULLISH").upper(),
        "title": payload.title,
        "content": payload.content,
        "media_url": payload.media_url,
        "media_poster": payload.media_poster or ("https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=1200&q=80" if payload.post_type == "vlog" else None),
        "duration": payload.duration or ("05:00" if payload.post_type == "vlog" else None),
        "chapters": [],
        "setup_score": payload.setup_score or 85,
        "entry_price": payload.entry_price,
        "target_price": payload.target_price,
        "stop_loss": payload.stop_loss,
        "likes_count": 1,
        "liked_by_me": True,
        "comments": []
    }
    _FEED_POSTS.insert(0, new_post)
    return {"status": "ok", "message": "Post published successfully", "post": new_post}


@router.post("/posts/{post_id}/like", summary="Toggle like for a post")
def like_post(post_id: str):
    """Toggle like count on a post."""
    for p in _FEED_POSTS:
        if p["id"] == post_id:
            if p.get("liked_by_me"):
                p["likes_count"] = max(0, p.get("likes_count", 1) - 1)
                p["liked_by_me"] = False
            else:
                p["likes_count"] = p.get("likes_count", 0) + 1
                p["liked_by_me"] = True
            return {"status": "ok", "likes_count": p["likes_count"], "liked_by_me": p["liked_by_me"]}

    raise HTTPException(status_code=404, detail="Post not found")


@router.post("/posts/{post_id}/comment", summary="Add a comment to a post")
def comment_post(post_id: str, payload: CommentRequest):
    """Add a new comment thread to a post."""
    for p in _FEED_POSTS:
        if p["id"] == post_id:
            new_comment = {
                "id": f"c-{uuid.uuid4().hex[:6]}",
                "author": payload.author,
                "author_handle": payload.author_handle,
                "author_badge": "Quant Member",
                "created_at": "Just now",
                "text": payload.text
            }
            if "comments" not in p:
                p["comments"] = []
            p["comments"].append(new_comment)
            return {"status": "ok", "comment": new_comment, "total_comments": len(p["comments"])}

    raise HTTPException(status_code=404, detail="Post not found")


@router.get("/news", summary="Get real-time breaking market news & signals")
def get_news():
    """Returns rolling breaking news stream with sentiment."""
    return {"status": "ok", "news": _REALTIME_NEWS}
