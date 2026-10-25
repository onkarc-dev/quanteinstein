"""Unit tests for the community, vlogs, and signals API."""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_community_feed():
    response = client.get("/community/feed")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "posts" in data
    assert len(data["posts"]) > 0

    first_post = data["posts"][0]
    assert "title" in first_post
    assert "author" in first_post
    assert "likes_count" in first_post


def test_create_post_and_interact():
    payload = {
        "title": "ETHUSDT 4H Breakout Retest Signal",
        "content": "Clean breakout above $3,500 resistance with 5m EMA alignment.",
        "post_type": "news_signal",
        "symbol": "ETHUSDT",
        "sentiment": "BULLISH",
        "entry_price": 3510.0,
        "target_price": 3680.0,
        "stop_loss": 3440.0,
        "setup_score": 94,
        "author": "Test Quant",
        "author_handle": "test_quant"
    }
    create_res = client.post("/community/posts", json=payload)
    assert create_res.status_code == 200
    post_data = create_res.json()["post"]
    post_id = post_data["id"]
    assert post_data["title"] == payload["title"]
    assert post_data["symbol"] == "ETHUSDT"

    # Test like
    like_res = client.post(f"/community/posts/{post_id}/like")
    assert like_res.status_code == 200
    assert "likes_count" in like_res.json()

    # Test comment
    comment_payload = {
        "author": "Reviewer Quant",
        "author_handle": "rev_quant",
        "text": "Solid risk-to-reward ratio on this setup!"
    }
    comment_res = client.post(f"/community/posts/{post_id}/comment", json=comment_payload)
    assert comment_res.status_code == 200
    comment_data = comment_res.json()["comment"]
    assert comment_data["text"] == comment_payload["text"]


def test_get_realtime_news():
    response = client.get("/community/news")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "news" in data
    assert len(data["news"]) > 0
