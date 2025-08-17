#!/usr/bin/env python3
"""
Scrape a J-Archive game page into CSV: show metadata + topic, money, question, answer.

Usage:
  python scrape_jarchive.py "https://www.j-archive.com/showgame.php?game_id=8881" -o clues.csv
"""

import argparse
import csv
import re
import sys
import time
from typing import List, Dict, Optional
from datetime import datetime

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; jarchive-scraper/1.0; +https://example.com/)",
    "Accept-Language": "en-US,en;q=0.8",
}

def fetch(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.text

def squish(text: str) -> str:
    """Collapse whitespace and strip."""
    if text is None:
        return ""
    return re.sub(r"\s+", " ", text).strip()

def parse_money(raw: Optional[str]) -> Optional[int]:
    """Extract dollar amount as int (e.g., '$1,600' or 'DD: $1,800' -> 1600/1800)."""
    if not raw:
        return None
    # Remove 'DD:' and everything non-digit; keep last number group.
    digits = re.findall(r"(\d[\d,]*)", raw)
    if not digits:
        return None
    amount = digits[-1].replace(",", "")
    try:
        return int(amount)
    except ValueError:
        return None

def get_first(soup, selector):
    el = soup.select_one(selector)
    return el

def text_or_blank(el) -> str:
    return squish(el.get_text(separator=" ", strip=True)) if el else ""

def extract_answer(clue_answer_td) -> str:
    """
    In the *_r (reveal) cell, the official answer is inside <em class="correct_response">…</em>.
    Ignore chatter, brackets, and tables about who rang in, etc.
    """
    if not clue_answer_td:
        return ""
    em = clue_answer_td.select_one("em.correct_response")
    return text_or_blank(em)

def parse_round(round_table, round_prefix: str) -> List[Dict]:
    """
    Parse one round table (class='round').

    round_prefix is 'J' for Jeopardy, 'DJ' for Double Jeopardy.
    """
    rows = []

    # Categories are in the first <tr> as six <td class="category">.
    cat_cells = round_table.select("tr > td.category")
    categories = []
    for cat in cat_cells:
        name = text_or_blank(cat.select_one(".category_name"))
        categories.append(name)

    # Subsequent <tr> each hold up to 6 <td class="clue"> aligned with categories
    # Note: Some cells can be empty placeholders.
    # We find all TRs after the category row.
    all_trs = round_table.select("tr")
    if not all_trs:
        return rows

    # Start from the second row of the table (skip category row)
    for tr in all_trs[1:]:
        clue_cells = tr.select("td.clue")
        if not clue_cells:
            continue

        for col_idx, cell in enumerate(clue_cells):
            # Empty cells have no clue text table
            if not cell.select_one("table"):
                continue

            # value: either .clue_value or .clue_value_daily_double
            val_td = cell.select_one(".clue_header .clue_value, .clue_header .clue_value_daily_double")
            money = parse_money(text_or_blank(val_td))

            # Find question & answer tds. IDs look like clue_J_1_1 and clue_J_1_1_r etc.
            # Safest: pick the non-reveal first 'clue_text' for the question and the '_r' for the answer.
            q_td = None
            a_td = None
            for td in cell.select("td.clue_text"):
                td_id = td.get("id", "")
                if td_id.endswith("_r"):
                    a_td = td
                else:
                    q_td = q_td or td  # first non-reveal is the question

            question = text_or_blank(q_td)
            answer = extract_answer(a_td)

            # Category for this column (if present)
            topic = categories[col_idx] if col_idx < len(categories) else ""

            if question or answer:
                rows.append({
                    "topic": topic,
                    "money": money,
                    "question": question,
                    "answer": answer,
                })

    return rows

def parse_final(soup: BeautifulSoup) -> List[Dict]:
    """
    Parse Final Jeopardy if present. Money is blank (you can fill 'Final Jeopardy' if preferred).
    """
    out = []
    final_tbl = soup.select_one("table.final_round")
    if not final_tbl:
        return out

    topic = text_or_blank(final_tbl.select_one(".category_name"))
    q_td = final_tbl.select_one("#clue_FJ")
    a_td = final_tbl.select_one("#clue_FJ_r")

    question = text_or_blank(q_td)
    answer = extract_answer(a_td)

    if question or answer:
        out.append({
            "topic": topic,
            "money": None,  # or use 'Final Jeopardy'
            "question": question,
            "answer": answer,
        })
    return out

def scrape_game_from_soup(soup: BeautifulSoup) -> List[Dict]:
    data: List[Dict] = []

    # Jeopardy round
    j_round = soup.select_one("#jeopardy_round table.round")
    if j_round:
        data.extend(parse_round(j_round, "J"))

    # Double Jeopardy round
    dj_round = soup.select_one("#double_jeopardy_round table.round")
    if dj_round:
        data.extend(parse_round(dj_round, "DJ"))

    # Final
    data.extend(parse_final(soup))

    return data

def extract_show_metadata(soup: BeautifulSoup, url: str) -> Dict:
    """Extract show-level metadata from the J-Archive page."""
    metadata = {}
    
    # Extract game ID from URL
    game_id_match = re.search(r'game_id=(\d+)', url)
    if game_id_match:
        metadata['show_id'] = game_id_match.group(1)
    
    # Try to extract air date
    air_date_el = soup.select_one('.game_comments, .game_comment')
    if air_date_el:
        date_text = air_date_el.get_text()
        # Look for date patterns like "aired 2024-01-15" or "January 15, 2024"
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', date_text)
        if date_match:
            metadata['air_date'] = date_match.group(1)
        else:
            # Try to parse other date formats
            date_match = re.search(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})', date_text)
            if date_match:
                month, day, year = date_match.groups()
                try:
                    parsed_date = datetime.strptime(f"{month} {day} {year}", "%B %d %Y")
                    metadata['air_date'] = parsed_date.strftime("%Y-%m-%d")
                except ValueError:
                    pass
    
    # Try to extract air date from title if it wasn't found earlier
    title_el = soup.select_one('h1, .game_title')
    if title_el and not metadata.get('air_date'):
        title_text = title_el.get_text()
        # Look for date patterns like "Wednesday, April 10, 2024"
        date_match = re.search(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})', title_text)
        if date_match:
            day_of_week, month, day, year = date_match.groups()
            try:
                parsed_date = datetime.strptime(f"{month} {day} {year}", "%B %d %Y")
                metadata['air_date'] = parsed_date.strftime("%Y-%m-%d")
            except ValueError:
                pass
    

    
    # Determine game type
    if soup.select_one('.tournament_game'):
        metadata['game_type'] = 'Tournament'
    elif soup.select_one('.celebrity_game'):
        metadata['game_type'] = 'Celebrity'
    elif soup.select_one('.college_game'):
        metadata['game_type'] = 'College'
    else:
        metadata['game_type'] = 'Regular'
    
    # Set defaults for missing metadata
    metadata.setdefault('show_id', '')
    metadata.setdefault('air_date', '')
    metadata.setdefault('game_type', 'Regular')
    
    return metadata

def write_csv(rows: List[Dict], path: str, metadata: Dict):
    # Add metadata columns to the beginning
    fieldnames = ["show_id", "air_date", "game_type", "topic", "money", "question", "answer"]
    
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        
        for r in rows:
            # Create new row with metadata + clue data
            row = {
                "show_id": metadata.get("show_id", ""),
                "air_date": metadata.get("air_date", ""),
                "game_type": metadata.get("game_type", ""),
                "topic": r.get("topic", ""),
                "money": r.get("money", "") if r.get("money") is not None else "",
                "question": r.get("question", ""),
                "answer": r.get("answer", ""),
            }
            w.writerow(row)

def main():
    ap = argparse.ArgumentParser(description="Scrape a J-Archive game page into CSV.")
    ap.add_argument("url", help="J-Archive game URL, e.g. https://www.j-archive.com/showgame.php?game_id=8881")
    ap.add_argument("-o", "--out", default="jarchive_clues.csv", help="Output CSV path (default: jarchive_clues.csv)")
    args = ap.parse_args()

    try:
        html = fetch(args.url)
        soup = BeautifulSoup(html, "lxml")
        
        # Extract metadata first
        metadata = extract_show_metadata(soup, args.url)
        
        # Then scrape the clues
        rows = scrape_game_from_soup(soup)
        if not rows:
            print("No clues found. The page structure may have changed or the URL is not a game page.", file=sys.stderr)
        
        write_csv(rows, args.out, metadata)
        print(f"Wrote {len(rows)} rows to {args.out}")
        print(f"Show metadata: {metadata}")
    except requests.HTTPError as e:
        print(f"HTTP error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
