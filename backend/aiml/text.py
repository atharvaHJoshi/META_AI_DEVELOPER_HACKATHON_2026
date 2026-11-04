"""Tokenisation and lexical scoring used by the deterministic analyser."""

from __future__ import annotations

import math
import re

_STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "from", "when", "have", "has",
    "are", "was", "were", "will", "would", "could", "should", "into", "onto",
    "customer", "customers", "user", "users", "some", "after", "before", "they",
    "them", "their", "our", "not", "but", "can", "may", "all", "any", "you",
    "your", "about", "over", "under", "more", "less", "than", "then", "also",
    "issue", "ticket", "problem", "report", "reported", "please", "need",
}

_NON_ALNUM = re.compile(r"[^a-z0-9\s-]")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_WHITESPACE = re.compile(r"\s+")


def tokenize(text: str) -> list[str]:
    cleaned = _NON_ALNUM.sub(" ", text.lower())
    return [
        token.strip()
        for token in cleaned.split()
        if len(token.strip()) > 2 and token.strip() not in _STOP_WORDS
    ]


def lexical_score(query: str, target: str) -> float:
    query_tokens = set(tokenize(query))
    target_tokens = set(tokenize(target))
    if not query_tokens or not target_tokens:
        return 0.0
    overlap = 0.0
    for token in query_tokens:
        if token in target_tokens:
            overlap += 1
        elif len(token) > 4 and any(
            candidate in token or token in candidate for candidate in target_tokens
        ):
            overlap += 0.5
    return overlap / math.sqrt(len(query_tokens) * len(target_tokens))


def excerpt(text: str, max_length: int = 240) -> str:
    clean = _WHITESPACE.sub(" ", text).strip()
    if len(clean) <= max_length:
        return clean
    return clean[: max_length - 1].rstrip() + "…"


def sentence_excerpt(text: str, keywords: list[str], max_length: int = 240) -> str:
    sentences = [
        sentence
        for sentence in _SENTENCE_SPLIT.split(_WHITESPACE.sub(" ", text).strip())
        if sentence
    ]
    lowered = [keyword.lower() for keyword in keywords]
    match = next(
        (
            sentence
            for sentence in sentences
            if any(keyword in sentence.lower() for keyword in lowered)
        ),
        None,
    )
    return excerpt(match if match is not None else text, max_length)
