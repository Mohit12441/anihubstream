#!/usr/bin/env python3
"""
Social Post Downloader CLI (Twitter/X & Reddit)
Downloads media (videos, images) and exports the post link, author, title,
and full description / text into formatted files (post_info.txt and post_info.json).

Dependencies:
- yt-dlp (for video/audio streams and Twitter/Reddit media)
- gallery-dl (for image galleries, photo threads, and illustrations)
"""

import os
import re
import sys
import json
import argparse
import subprocess
from datetime import datetime
from urllib.parse import urlparse

# Ensure UTF-8 output across Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def sanitize_filename(name: str, max_length: int = 50) -> str:
    """Sanitize strings for folder and file names."""
    if not name:
        return "untitled"
    # Replace invalid filesystem characters
    clean = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    clean = re.sub(r"\s+", "_", clean)
    return clean[:max_length] if clean else "untitled"


def detect_platform(url: str) -> str:
    """Detect platform from URL."""
    domain = urlparse(url).netloc.lower()
    if "twitter.com" in domain or "x.com" in domain or "t.co" in domain:
        return "twitter"
    if "reddit.com" in domain or "redd.it" in domain:
        return "reddit"
    return "general"


def extract_metadata_ytdlp(url: str) -> dict:
    """Extract metadata using yt-dlp JSON dump."""
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--no-playlist",
        "--skip-download",
        url
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        if result.returncode == 0 and result.stdout.strip():
            # In case multiple lines of JSON are output, take the first valid one
            for line in result.stdout.strip().splitlines():
                line = line.strip()
                if line.startswith("{"):
                    try:
                        return json.loads(line)
                    except json.JSONDecodeError:
                        continue
    except FileNotFoundError:
        print("[!] Warning: yt-dlp is not installed or not in PATH.", file=sys.stderr)
    except Exception as e:
        print(f"[!] Warning: yt-dlp extraction error: {e}", file=sys.stderr)
    return {}


def extract_metadata_gallerydl(url: str) -> list:
    """Extract metadata using gallery-dl JSON dump."""
    cmd = [
        sys.executable,
        "-m",
        "gallery_dl",
        "-j",
        url
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        if result.returncode == 0 and result.stdout.strip():
            try:
                data = json.loads(result.stdout.strip())
                if isinstance(data, list):
                    return data
            except json.JSONDecodeError:
                pass
    except Exception as e:
        print(f"[!] Warning: gallery-dl extraction error: {e}", file=sys.stderr)
    return []


def download_post(url: str, output_base: str = "downloads", print_only: bool = False):
    """Process a single post URL: download media and save link + description."""
    url = url.strip()
    if not url:
        return False

    platform = detect_platform(url)
    print(f"\n" + "=" * 60)
    print(f"[*] Processing [{platform.upper()}]: {url}")
    print("=" * 60)

    metadata = extract_metadata_ytdlp(url)
    gallery_data = []

    # If yt-dlp returned minimal or no info (e.g. image-only post), try gallery-dl
    if not metadata:
        gallery_data = extract_metadata_gallerydl(url)

    # Compile unified post fields
    post_id = None
    author = "Unknown"
    title = ""
    description = ""
    canonical_url = url
    upload_date = ""

    if metadata:
        post_id = metadata.get("id")
        author = metadata.get("uploader") or metadata.get("channel") or metadata.get("creator") or "Unknown"
        title = metadata.get("title") or ""
        description = metadata.get("description") or ""
        canonical_url = metadata.get("webpage_url") or url
        upload_date = metadata.get("upload_date") or ""
        if upload_date and len(upload_date) == 8:
            # Format YYYYMMDD -> YYYY-MM-DD
            upload_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"

    elif gallery_data:
        # Parse gallery-dl response structure
        # gallery-dl outputs: [[code, {metadata_dict}, ...], ...]
        for item in gallery_data:
            if isinstance(item, list) and len(item) >= 2 and isinstance(item[1], dict):
                info = item[1]
                post_id = info.get("post_id") or info.get("tweet_id") or info.get("id")
                author = info.get("author") or info.get("user", {}).get("name") or info.get("subreddit") or author
                title = info.get("title") or ""
                description = info.get("content") or info.get("description") or ""
                upload_date = str(info.get("date") or "")
                break

    if not post_id:
        # Fallback post ID from URL
        match = re.search(r"/(?:status|comments)/([a-zA-Z0-9_]+)", url)
        post_id = match.group(1) if match else "post_" + str(int(datetime.now().timestamp()))

    # Print summary to console
    print(f"  -> Platform:    {platform.title()}")
    print(f"  -> Post Link:   {canonical_url}")
    print(f"  -> Author:      {author}")
    if title and title != description:
        print(f"  -> Title:       {title[:80]}")
    if upload_date:
        print(f"  -> Date:        {upload_date}")
    print(f"  -> Description: {description[:120].strip() + '...' if len(description) > 120 else description.strip() or '(None)'}")

    if print_only:
        print("\n--- Full Description ---")
        print(description or "(No text description provided)")
        print("-" * 24)
        return True

    # Create destination directory
    folder_name = f"{platform}_{sanitize_filename(author, 20)}_{post_id}"
    dest_dir = os.path.join(output_base, folder_name)
    os.makedirs(dest_dir, exist_ok=True)

    # 1. Write formatted human-readable post_info.txt
    txt_path = os.path.join(dest_dir, "post_info.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("============================================================\n")
        f.write(f"Source Platform: {platform.title()}\n")
        f.write(f"Post URL:        {canonical_url}\n")
        f.write(f"Author / User:   {author}\n")
        if upload_date:
            f.write(f"Upload Date:     {upload_date}\n")
        if title:
            f.write(f"Post Title:      {title}\n")
        f.write("============================================================\n\n")
        f.write("DESCRIPTION / POST CONTENT:\n")
        f.write("------------------------------------------------------------\n")
        f.write((description if description else "(No description text)").strip())
        f.write("\n------------------------------------------------------------\n\n")
        f.write(f"Saved At: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    print(f"  [+] Saved Post Link & Description to: {txt_path}")

    # 2. Write structured post_info.json
    json_path = os.path.join(dest_dir, "post_info.json")
    json_payload = {
        "platform": platform,
        "post_url": canonical_url,
        "author": author,
        "post_id": post_id,
        "title": title,
        "description": description,
        "upload_date": upload_date,
        "scraped_at": datetime.now().isoformat(),
        "raw_metadata": metadata if metadata else gallery_data
    }
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_payload, f, indent=2, ensure_ascii=False)
    print(f"  [+] Saved Structured Metadata to:      {json_path}")

    # 3. Download Media
    # Try yt-dlp first for video/audio
    media_pattern = os.path.join(dest_dir, "%(title).50s_%(id)s.%(ext)s")
    ytdlp_cmd = [
        "yt-dlp",
        "-o", media_pattern,
        "--no-playlist",
        url
    ]
    print(f"  [*] Downloading media files into: {dest_dir}...")
    dl_res = subprocess.run(ytdlp_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

    # If yt-dlp failed (e.g. image tweet or photo album), invoke gallery-dl
    if dl_res.returncode != 0:
        gallery_cmd = [
            sys.executable,
            "-m",
            "gallery_dl",
            "-d", dest_dir,
            url
        ]
        gdl_res = subprocess.run(gallery_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if gdl_res.returncode == 0:
            print(f"  [+] Media downloaded via gallery-dl.")
        else:
            print(f"  [!] Note: Media download exited. Check {txt_path} for extracted link & text.")
    else:
        print(f"  [+] Media downloaded via yt-dlp.")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="CLI tool to download media from Twitter/X and Reddit, and save the post link + description."
    )
    parser.add_argument("urls", nargs="*", help="One or more Twitter or Reddit post URLs")
    parser.add_argument("-f", "--file", help="Path to a text file containing URLs (one per line)")
    parser.add_argument("-o", "--output", default="downloads", help="Destination folder (default: downloads/)")
    parser.add_argument("--print-only", action="store_true", help="Print the link and description to the console without downloading media")

    args = parser.parse_args()

    target_urls = list(args.urls)

    if args.file:
        if not os.path.isfile(args.file):
            print(f"Error: File '{args.file}' does not exist.", file=sys.stderr)
            sys.exit(1)
        with open(args.file, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    target_urls.append(line)

    if not target_urls:
        parser.print_help()
        print("\nExample usage:")
        print('  python tools/social-post-dl.py "https://x.com/username/status/123456789"')
        print('  python tools/social-post-dl.py "https://www.reddit.com/r/anime/comments/xyz/title/"')
        print('  python tools/social-post-dl.py --file links.txt -o ./my_downloads')
        sys.exit(0)

    success_count = 0
    for url in target_urls:
        if download_post(url, output_base=args.output, print_only=args.print_only):
            success_count += 1

    print("\n" + "=" * 60)
    print(f"[✓] Finished: Successfully processed {success_count}/{len(target_urls)} post(s).")
    print("=" * 60)


if __name__ == "__main__":
    main()
