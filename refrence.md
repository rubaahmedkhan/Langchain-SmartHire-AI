from agents import Agent, Runner, function_tool, set_default_openai_key
import os
import asyncio
from google.cloud import vision
from sentence_transformers import SentenceTransformer, util
from dotenv import load_dotenv
from pathlib import Path
import io
import logging
from typing import Dict, List, Optional, Tuple
import time
from concurrent.futures import ThreadPoolExecutor
import re
import json
from openai import AsyncOpenAI

# Configure logging — write to file AND terminal
_log_file_path = Path(__file__).parent / "backend.log"
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(_log_file_path, encoding='utf-8', mode='a'),
        logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables from root .env
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# === API Keys with validation ===
openai_api_key = os.getenv("OPENAI_API_KEY")
vision_api_key = os.getenv("VISION_KEY")

if not openai_api_key:
    raise ValueError("OPENAI_API_KEY not found in environment variables")
if not vision_api_key:
    raise ValueError("VISION_KEY not found in environment variables")

# Set the OpenAI API key for the Agents SDK
set_default_openai_key(openai_api_key)
logger.info("OpenAI API key configured successfully")

# VISION_KEY can be either a path to a credentials JSON file or an API key string.
if os.path.exists(vision_api_key):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = vision_api_key
    logger.info(f"Using Vision credentials file: {vision_api_key}")
else:
    logger.info("VISION_KEY detected as API key string, will pass to client directly")

# === Google Vision & Semantic Model Setup with error handling ===
try:
    if os.path.exists(vision_api_key):
        # Use service account credentials file
        vision_client = vision.ImageAnnotatorClient()
    else:
        # Use API key directly
        vision_client = vision.ImageAnnotatorClient(
            client_options={"api_key": vision_api_key}
        )
    logger.info("Google Vision client initialized")
except Exception as e:
    logger.error(f"Failed to initialize Vision client: {str(e)}")
    raise

try:
    semantic_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
    logger.info("Semantic model loaded successfully")
except Exception as e:
    logger.error(f"Failed to load semantic model: {str(e)}")
    raise

# Thread pool for parallel processing
executor = ThreadPoolExecutor(max_workers=3)

# === Helper Functions with Error Handling ===

def _make_vision_client():
    """Create a fresh Vision API client (avoids gRPC socket reuse issues under concurrent load)."""
    if os.path.exists(vision_api_key):
        return vision.ImageAnnotatorClient()
    return vision.ImageAnnotatorClient(client_options={"api_key": vision_api_key})


def _ocr_image_content(content: bytes, source_label: str) -> Tuple[str, Optional[str]]:
    """Run Google Vision OCR on raw image bytes with column-aware layout preservation.
    Retries up to 3 times with a fresh gRPC client to handle 503/socket errors under concurrency."""
    import time as _time

    last_err = None
    for attempt in range(3):
        try:
            # Fresh client each attempt avoids stale gRPC socket under concurrent load
            client = _make_vision_client()
            image = vision.Image(content=content)

            # Use document_text_detection for block-level analysis
            response = client.document_text_detection(image=image)

            if response.error.message:
                last_err = f'Vision API Error: {response.error.message}'
                _time.sleep(1.5 * (attempt + 1))
                continue

            # Fallback 1: Use full_text_annotation
            if response.full_text_annotation and response.full_text_annotation.text:
                extracted_text = response.full_text_annotation.text
                logger.info(f"Successfully extracted {len(extracted_text)} characters from {source_label} (document mode, attempt {attempt+1})")

                return extracted_text, None

            # Fallback 2: text_detection
            response2 = client.text_detection(image=image)
            texts = response2.text_annotations
            if texts and len(texts) > 0:
                extracted_text = texts[0].description
                logger.info(f"Successfully extracted {len(extracted_text)} characters from {source_label} (fallback mode, attempt {attempt+1})")
                return extracted_text, None

            return "", None

        except Exception as e:
            last_err = str(e)
            logger.warning(f"Vision API attempt {attempt+1} failed for {source_label}: {last_err}")
            if attempt < 2:
                _time.sleep(2 * (attempt + 1))  # 2s, 4s backoff

    return "", f"Vision API failed after 3 attempts: {last_err}"


def _extract_text_from_pdf(pdf_path: str) -> Tuple[str, Optional[str]]:
    """Extract text from a PDF by converting each page to an image and running OCR."""
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(pdf_path)
        all_text = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            # Render page at 200 DPI for good OCR quality
            pix = page.get_pixmap(dpi=200)
            img_bytes = pix.tobytes("png")

            page_text, err = _ocr_image_content(img_bytes, f"{pdf_path} page {page_num + 1}")
            if err:
                doc.close()
                return "", err
            if page_text:
                all_text.append(page_text)

        doc.close()

        combined = "\n".join(all_text)
        if not combined.strip():
            return "", "No text found in PDF"

        logger.info(f"Successfully extracted {len(combined)} characters from PDF {pdf_path} ({len(all_text)} pages)")
        return combined, None

    except Exception as e:
        logger.error(f"Error processing PDF {pdf_path}: {str(e)}")
        return "", f"PDF processing error: {str(e)}"


def extract_text_with_vision(image_path: str) -> Tuple[str, Optional[str]]:
    """
    Extract text from image or PDF using Google Vision API
    Returns: (extracted_text, error_message)
    """
    try:
        if not os.path.exists(image_path):
            return "", f"File not found: {image_path}"

        # Check file size (limit to 10MB)
        file_size = os.path.getsize(image_path)
        if file_size > 10 * 1024 * 1024:
            return "", f"File too large: {file_size / (1024*1024):.2f}MB (max 10MB)"

        # Check file extension
        valid_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.pdf'}
        if not any(image_path.lower().endswith(ext) for ext in valid_extensions):
            return "", f"Invalid file type. Supported: {', '.join(valid_extensions)}"

        # Handle PDF files
        if image_path.lower().endswith('.pdf'):
            return _extract_text_from_pdf(image_path)

        # Handle image files
        with io.open(image_path, 'rb') as image_file:
            content = image_file.read()

        text, err = _ocr_image_content(content, image_path)
        if err:
            return "", err
        if not text:
            return "", "No text found in image"
        return text, None

    except Exception as e:
        logger.error(f"Error extracting text from {image_path}: {str(e)}")
        return "", f"OCR Error: {str(e)}"

def split_sentences(text: str) -> List[str]:
    """Split text into meaningful sentences — supports English, Urdu, Arabic, and mixed text"""
    if not text:
        return []

    try:
        text = text.replace('\n', ' ').replace('\r', ' ')
        text = re.sub(r'\s+', ' ', text).strip()

        # Split on English and Urdu/Arabic sentence-ending punctuation + comma (compound answers)
        sentences = re.split(r'[.!?؟۔،,:\-;]+', text)

        cleaned = []
        for s in sentences:
            s = s.strip()
            if len(s) < 5:
                continue
            # Accept if it has any letter from any script (Unicode letter category)
            if re.search(r'[a-zA-Z\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]', s):
                cleaned.append(s)

        # If splitting produced nothing, try splitting by newlines or fixed chunks
        if not cleaned and len(text) >= 10:
            # Try splitting by common separators
            parts = re.split(r'[\n\r]+', text.replace('\n', '\n'))
            if len(parts) <= 1:
                # Just chunk the text into ~100 char pieces
                for i in range(0, len(text), 100):
                    chunk = text[i:i+100].strip()
                    if len(chunk) >= 5:
                        cleaned.append(chunk)
            else:
                for p in parts:
                    p = p.strip()
                    if len(p) >= 5:
                        cleaned.append(p)

        logger.info(f"Split text into {len(cleaned)} sentences (text length: {len(text)})")
        return cleaned
    except Exception as e:
        logger.error(f"Error splitting sentences: {str(e)}")
        return []


def _normalize_text(text: str) -> str:
    """Normalize text before semantic embedding: lowercase, strip punctuation, collapse whitespace."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text
def clean_ocr_noise(text: str) -> str:
    """
    Remove keyboard artifacts and OCR noise from extracted text.
    Handles: 'ctri B enter shift', random key combos, control characters, etc.
    """
    if not text:
        return text

    # Common keyboard/UI noise patterns (case-insensitive removal)
    noise_patterns = [
        r'\b(?:ctrl|ctri|ctr1)\s*[+]?\s*[a-z]\b',          # ctrl+B, ctri B
        r'\b(?:shift|enter|tab|esc|backspace|delete|alt)\b',  # keyboard keys
        r'\b(?:caps\s*lock|num\s*lock|scroll\s*lock)\b',     # lock keys
        r'\b(?:page\s*up|page\s*down|home|end|insert)\b',    # navigation keys
        r'\b[Ff]\d{1,2}\b',                                   # F1-F12
        r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]',               # control characters
    ]

    cleaned = text
    for pattern in noise_patterns:
        cleaned = re.sub(pattern, ' ', cleaned, flags=re.IGNORECASE)

    # Collapse multiple spaces
    cleaned = re.sub(r' {2,}', ' ', cleaned)
    # Remove lines that are ONLY noise (less than 3 real characters after cleaning)
    lines = cleaned.split('\n')
    filtered_lines = []
    for line in lines:
        stripped = line.strip()
        # Keep line if it has at least 3 alphanumeric characters
        if len(re.findall(r'[a-zA-Z0-9\u0600-\u06FF]', stripped)) >= 3:
            filtered_lines.append(line)
        elif stripped:  # Keep short but non-empty lines (could be numbers, marks)
            if re.search(r'\d', stripped):
                filtered_lines.append(line)

    result = '\n'.join(filtered_lines)
    if result != text:
        noise_removed = len(text) - len(result)
        logger.info(f"OCR noise cleaned: removed {noise_removed} characters")

    return result


def _normalize_reference_ocr(text: str) -> str:
    """
    Pre-process OCR artifacts specific to reference/answer papers before LLM parsing.

    Common OCR failures on reference papers:
      - 'QO' / 'Q0'  → 'Q10'  (OCR misreads '10' as letter-O or zero)
      - 'Q.9', 'Q-9' → 'Q9'   (stray punctuation between Q and number)
      - 'Ql'         → 'Q1'   (lowercase-L mistaken for digit-1)
    """
    if not text:
        return text

    # QO / Q0 at a word boundary → Q10
    text = re.sub(r'\bQO\b', 'Q10', text)
    text = re.sub(r'\bQ0\b',  'Q10', text)

    # Q.N or Q-N → QN  (e.g. Q.9 → Q9, Q-10 → Q10)
    text = re.sub(r'\bQ[.\-](\d{1,2})\b', r'Q\1', text)

    # Ql (Q + lowercase-L) → Q1
    text = re.sub(r'\bQl\b', 'Q1', text)

    return text


# === WORDS THAT COME AFTER NUMBERS BUT ARE NOT QUESTION STARTS ===
# "2 advantages" "3 types" "5 reasons" — these are quantity phrases, NOT question numbers
_QUANTITY_WORDS = {
    'advantages', 'advantage', 'types', 'type', 'reasons', 'reason',
    'examples', 'example', 'points', 'point', 'ways', 'way',
    'methods', 'method', 'factors', 'factor', 'steps', 'step',
    'features', 'feature', 'characteristics', 'differences', 'difference',
    'similarities', 'similarity', 'benefits', 'benefit', 'causes', 'cause',
    'effects', 'effect', 'functions', 'function', 'properties', 'property',
    'marks', 'mark', 'lines', 'line', 'words', 'word', 'sentences',
    'paragraphs', 'pages', 'chapters', 'questions', 'answers',
    'minutes', 'hours', 'days', 'years', 'months', 'weeks',
    'kg', 'km', 'cm', 'mm', 'ml', 'grams', 'meters', 'litres',
}

# Max valid question number for a school paper
_MAX_QUESTION_NUM = 20


def _is_false_positive(text: str, match_end: int) -> bool:
    """
    Check if a number match is actually a quantity phrase like "2 advantages".
    Returns True if it's a false positive (NOT a real question number).
    """
    # Get the word that follows the number
    remaining = text[match_end:match_end + 30].strip().lower()
    first_word = remaining.split()[0] if remaining.split() else ""
    return first_word in _QUANTITY_WORDS


def _remove_header_footer(text: str) -> str:
    """
    Remove exam header/footer junk lines BEFORE question detection.
    Lines like: "6/2/2.6 Final term 1th Review best", "Class 10-A", "Roll Number"
    """
    header_patterns = [
        r'(?i)\b(?:final|mid)\s*term\b',                # "Final term", "Mid term"
        r'(?i)\breview\b',                                # "Review"
        r'(?i)\b(?:class|grade)\s*\d',                    # "Class 10", "Grade 9"
        r'(?i)\b(?:roll\s*(?:no|number|#))\b',           # "Roll No", "Roll Number"
        r'(?i)\b(?:name|student\s*name)\s*[:\-]',         # "Name:", "Student Name:"
        r'(?i)\b(?:subject|paper)\s*[:\-]',               # "Subject:", "Paper:"
        r'(?i)\b(?:date|time)\s*[:\-]',                   # "Date:", "Time:"
        r'(?i)\b(?:total\s*marks|max\s*marks)\s*[:\-]',   # "Total Marks:"
        r'^\s*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b',     # Date patterns: 6/2/2026, 12-03-25
    ]

    lines = text.split('\n')
    # Only strip from the TOP of the document (first 5 lines)
    header_end = min(5, len(lines))
    cleaned_lines = []

    for i, line in enumerate(lines):
        stripped = line.strip()
        if i < header_end and stripped:
            is_header = False
            for pattern in header_patterns:
                if re.search(pattern, stripped):
                    is_header = True
                    logger.debug(f"Removed header line: '{stripped}'")
                    break
            if is_header:
                continue
        cleaned_lines.append(line)

    result = '\n'.join(cleaned_lines)
    if result != text:
        logger.info(f"Header/footer removal: removed {len(text) - len(result)} characters")
    return result


def _merge_standalone_number_lines(text: str) -> str:
    """
    Merge standalone numeric lines with the next text line.

    OCR often splits question headers across lines:
        01
        13 Give 2 advantages of trade

    This becomes:
        01 13 Give 2 advantages of trade

    Only merges if:
    - Current line is ONLY a 1-2 digit number (possibly zero-padded)
    - Next line has actual text content
    """
    lines = text.split('\n')
    merged = []
    i = 0

    while i < len(lines):
        stripped = lines[i].strip()

        # Check if this line is ONLY a 1-2 digit number
        if re.match(r'^\d{1,2}$', stripped) and i + 1 < len(lines):
            next_stripped = lines[i + 1].strip()
            # Only merge if next line has text (not just numbers or empty)
            if next_stripped and re.search(r'[a-zA-Z\u0600-\u06FF]', next_stripped):
                merged_line = f"{stripped} {next_stripped}"
                merged.append(merged_line)
                logger.debug(f"Merged standalone number line: '{stripped}' + '{next_stripped[:40]}...'")
                i += 2
                continue

        merged.append(lines[i])
        i += 1

    result = '\n'.join(merged)
    if result != text:
        logger.info(f"Standalone number merge: merged lines in text")
    return result


def _is_bullet_not_question(text: str, match, prev_text: str) -> bool:
    """
    Check if a number match is a bullet/list item inside an answer, NOT a new question.

    Example:
        "Advantages of trade:
         1 It provides goods
         2 It creates employment"

    Here "2" is a bullet point, not Q2.

    Heuristic: If the text BEFORE this match looks like an answer body
    (contains answer keywords, doesn't end a question), it's a bullet.
    """
    # Get the last 100 chars before this match
    before = prev_text[-100:].strip().lower() if prev_text else ""

    # If preceded by answer-like context (colon, list intro, "following", "are:")
    bullet_intro_patterns = [
        r':\s*$',                    # ends with colon
        r'(?:following|these|are)\s*[:.]?\s*$',
        r'(?:advantages?|disadvantages?|types?|reasons?|features?|points?)\s*[:.]?\s*$',
        r'\bans(?:wer)?\b',          # "Ans" appeared before
    ]

    for pat in bullet_intro_patterns:
        if re.search(pat, before):
            return True

    return False


def _detect_parts_within_question(question_text: str) -> List[Dict]:
    """
    Detect sub-parts within a question (i, ii, iii, a, b, c, etc.)

    Supports:
    - Circled numbers: ①②③④⑤
    - Parenthesized roman: (i), (ii), (iii), (iv), (v)
    - Roman with punctuation: i., ii., iii., iv., v.
    - Letters with punctuation: a., b., c., d. OR a), b), c), d)
    """
    if not question_text or len(question_text) < 10:
        return []

    # Part marker patterns (ordered by priority)
    patterns = [
        # Circled numbers ①②③④⑤
        ("circled", re.compile(r'([\u2460-\u2469])', re.UNICODE)),
        # Parenthesized lowercase roman: (i), (ii), (iii)
        ("roman-paren", re.compile(r'\(([ivxlcdm]+)\)', re.IGNORECASE)),
        # Roman with punctuation: i., ii., iii., iv., v.
        ("roman-punct", re.compile(r'\b([ivx]+)\.\s', re.IGNORECASE)),
        # Letters with punctuation: a., b., c. OR a), b), c)
        ("letter-punct", re.compile(r'\b([a-e])[\.\)]\s', re.IGNORECASE)),
        # Numeric parts: 1., 2., 3., 4. (within question, not at start)
        ("numeric-punct", re.compile(r'(?<!\n)\s+(\d{1,2})[\.\)]\s+(?=[A-Z])', re.UNICODE)),
    ]

    for pattern_name, pattern in patterns:
        matches = list(pattern.finditer(question_text))
        if len(matches) >= 2:  # Need at least 2 parts to be meaningful
            parts = []
            for i, match in enumerate(matches):
                # Extract part marker
                if pattern_name == "circled":
                    char = match.group(1)
                    part_num = ord(char) - ord('①') + 1
                    part_label = f"Part {part_num}"
                elif pattern_name == "roman-paren":
                    part_label = f"({match.group(1)})"
                elif pattern_name == "roman-punct":
                    part_label = f"{match.group(1)}."
                elif pattern_name == "numeric-punct":
                    part_label = f"Part {match.group(1)}"
                else:  # letter-punct
                    part_label = f"{match.group(1)})"

                # Extract text for this part
                text_start = match.end()
                text_end = matches[i + 1].start() if i + 1 < len(matches) else len(question_text)
                part_text = question_text[text_start:text_end].strip()

                if len(part_text) >= 5:  # Ensure substantive content
                    parts.append({
                        'part': part_label,
                        'text': part_text,
                        'marks': _extract_marks_from_text(part_text[:100])
                    })

            if len(parts) >= 2:
                logger.info(f"  Detected {len(parts)} sub-parts using pattern '{pattern_name}'")
                return parts

    return []


def split_into_questions(text: str) -> List[Dict]:
    """
    Split text into question-wise blocks.

    ARCHITECTURE:
    1. Clean OCR noise
    2. Remove header/footer junk
    3. Merge standalone number lines with next line
    4. Try each detection strategy
    5. Validate matches (sequential, range 1-20, no false positives)
    6. If parsing FAILS → return empty list (caller must handle)
       NEVER silently fallback to single-block mode.
    7. NEW: Detect sub-parts within each question (i, ii, a, b, etc.)
    """
    if not text:
        return []

    text = clean_ocr_noise(text)
    text = _remove_header_footer(text)
    text = _merge_standalone_number_lines(text)

    # Try strategies in priority order
    for name, detect_fn in [
        ("line-scan", lambda: _line_scan_questions(text)),
        ("inline-scan", lambda: _inline_scan_questions(text)),
        ("answer-scan", lambda: _answer_scan_questions(text)),
    ]:
        result = detect_fn()
        # Accept 1+ questions (strategies already validate confidence)
        if result and len(result) >= 1:
            logger.info(f"Strategy '{name}' detected {len(result)} questions: "
                        f"{[q['question'] for q in result]}")

            # Detect sub-parts within each question
            for question in result:
                parts = _detect_parts_within_question(question['text'])
                if parts:
                    question['parts'] = parts
                    logger.info(f"  {question['question']} has {len(parts)} sub-parts")

            return result

    # ALL strategies failed
    logger.warning(f"All question detection strategies failed. Text preview: {text[:150]}")
    return []


def _extract_marks_from_text(text: str) -> Optional[int]:
    """
    Extract marks ONLY from explicit patterns:
    '[3 marks]', '(3 marks)', '3 marks', '/3'
    Does NOT treat bare numbers as marks.
    """
    patterns = [
        r'[\[\(]\s*(\d+)\s*(?:marks?|نمبر|m)?\s*[\]\)]',
        r'(\d+)\s*marks\b',
        r'/\s*(\d+)\b',
    ]
    for pat in patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            val = int(match.group(1))
            if 1 <= val <= 50:
                return val
    return None


def _validate_and_build_questions(text: str, matches: list, pattern_name: str) -> List[Dict]:
    """
    Given a list of regex matches, validate them and build question list.
    Rejects false positives and out-of-range numbers.

    SPECIAL HEURISTIC: If we find Q2 (or Q3) but NOT Q1, everything
    before Q2 is assumed to be Q1. This handles OCR garbling the first
    question number (e.g., "01" read as "32").
    """
    # False-positive filtering ONLY for bare-number patterns
    # Q-prefix (Q1), zero-padded (01), and punctuated (1.) are already high-confidence
    apply_fp_filter = pattern_name in ("num-bare", "num-bare-inline")

    # Filter: extract question numbers, reject false positives
    valid_matches = []
    logger.info(f"🔍 Validation starting for pattern '{pattern_name}' with {len(matches)} raw matches")
    for m in matches:
        try:
            # Handle circled Unicode numbers (①②③④⑤⑥⑦⑧⑨⑩)
            if pattern_name in ("circled", "circled-inline"):
                char = m.group(1)
                # Convert Unicode circled number to int: ① = 1, ② = 2, etc.
                q_num = ord(char) - ord('①') + 1
                logger.info(f"  Circled number '{char}' → Q{q_num}")
                if q_num < 1 or q_num > 10:
                    logger.info(f"  ❌ Rejected: out of range 1-10")
                    continue
            else:
                q_num = int(m.group(1))
        except (ValueError, IndexError) as e:
            logger.info(f"  ❌ Exception extracting q_num: {e}")
            continue

        # Reject if number is too high (not a valid question number)
        if q_num < 1 or q_num > _MAX_QUESTION_NUM:
            logger.debug(f"Rejected Q{q_num} — out of range 1-{_MAX_QUESTION_NUM}")
            continue

        # Reject quantity words ONLY for bare-number patterns
        if apply_fp_filter and _is_false_positive(text, m.end()):
            word_after = text[m.end():m.end() + 20].strip().split()[0] if text[m.end():m.end() + 20].strip() else ""
            logger.debug(f"Rejected Q{q_num} — false positive (followed by '{word_after}')")
            continue

        # Reject bullet-point numbers inside answer text (e.g., "2 It creates employment")
        prev_text = text[:m.start()]
        if apply_fp_filter and _is_bullet_not_question(text, m, prev_text):
            logger.debug(f"Rejected Q{q_num} — looks like a bullet point inside an answer")
            continue

        valid_matches.append((q_num, m))

    # === HEURISTIC: If only Q2 (or Q3...) found, infer Q1 from text before it ===
    if len(valid_matches) == 1:
        only_qnum, only_match = valid_matches[0]
        if only_qnum >= 2:
            # There's text before this match — that's likely Q1
            text_before = text[:only_match.start()].strip()
            if len(text_before) >= 10:
                logger.info(f"Inferred Q1 from text before Q{only_qnum} (OCR likely garbled Q1)")
                print(f"\n  ℹ Inferred Q1: OCR may have garbled the first question number. "
                      f"Text before Q{only_qnum} treated as Q1.\n")

                # Check for marks in the text before
                q1_marks = _extract_marks_from_text(text_before[:80])

                # Build Q1 from text before, and Q2+ from matched position
                text_after = text[only_match.end():].strip()
                header = text[only_match.start():min(only_match.end() + 50, len(text))]
                q2_marks = _extract_marks_from_text(header)

                questions = []
                if len(text_before) >= 3:
                    questions.append({
                        'question': 'Q1',
                        'text': text_before,
                        'marks': q1_marks
                    })
                if len(text_after) >= 3:
                    questions.append({
                        'question': f'Q{only_qnum}',
                        'text': text_after,
                        'marks': q2_marks
                    })
                if len(questions) >= 2:
                    return questions

    # Allow single question for high-confidence patterns (circled, Q-prefix, zero-padded)
    # Low-confidence patterns still require 2+ questions
    high_confidence = pattern_name in ("Q-prefix", "zero-padded", "circled", "circled-inline", "Q-inline", "zero-inline")
    min_required = 1 if high_confidence else 2

    if len(valid_matches) < min_required:
        logger.info(f"Pattern '{pattern_name}': {len(valid_matches)} matches < {min_required} required")
        return []

    # Check sequential ordering
    q_nums = [qn for qn, _ in valid_matches]
    if q_nums != sorted(q_nums):
        # Try removing duplicates and re-check
        seen = set()
        deduped = []
        for qn, m in valid_matches:
            if qn not in seen:
                seen.add(qn)
                deduped.append((qn, m))
        valid_matches = deduped
        q_nums = [qn for qn, _ in valid_matches]
        if len(q_nums) < 2 or q_nums != sorted(q_nums):
            logger.debug(f"Pattern '{pattern_name}' rejected — non-sequential: {q_nums}")
            return []

    # Build question list by splitting text between matches
    questions = []

    # If first question is not Q1, add text before it as Q1
    first_qnum, first_match = valid_matches[0]
    if first_qnum > 1:
        text_before = text[:first_match.start()].strip()
        if len(text_before) >= 10:
            logger.info(f"Adding inferred Q1 from text before Q{first_qnum}")
            q1_marks = _extract_marks_from_text(text_before[:80])
            questions.append({
                'question': 'Q1',
                'text': text_before,
                'marks': q1_marks
            })

    for i, (q_num, match) in enumerate(valid_matches):
        text_start = match.end()
        text_end = valid_matches[i + 1][1].start() if i + 1 < len(valid_matches) else len(text)
        q_text = text[text_start:text_end].strip()

        if not q_text or len(q_text) < 3:
            continue

        header = text[match.start():min(text_start + 50, len(text))]
        q_marks = _extract_marks_from_text(header)

        questions.append({
            'question': f'Q{q_num}',
            'text': q_text,
            'marks': q_marks
        })

    # Return questions (already validated earlier based on pattern confidence)
    logger.info(f"✅ Validation complete: {len(questions)} questions built from pattern '{pattern_name}'")
    return questions


def _line_scan_questions(text: str) -> List[Dict]:
    """Scan text line-by-line for question markers at line starts."""
    patterns = [
        # HIGHEST PRIORITY: Q-prefix (Q1, Q2, Question 1, etc.)
        ("Q-prefix", re.compile(
            r'(?:^|\n)\s*[Qq](?:uestion)?\s*[.:\-)]?\s*(\d{1,2})',
            re.MULTILINE | re.UNICODE)),
        # Circled numbers ①②③④⑤⑥⑦⑧⑨⑩ (can be main Q or sub-parts)
        ("circled", re.compile(
            r'(?:^|\n)\s*([\u2460-\u2469])',
            re.MULTILINE | re.UNICODE)),
        # Zero-padded: 01, 02, 03 at line start
        # After merge, "01 13 Give..." — zero-padded can be followed by number or letter
        ("zero-padded", re.compile(
            r'(?:^|\n)\s*(0[1-9])\s+(?=\S)',
            re.MULTILINE | re.UNICODE)),
        # Number + punctuation: "1.", "2)", "3:"
        ("num-punct", re.compile(
            r'(?:^|\n)\s*(\d{1,2})\s*[.):\-]\s+(?=[A-Za-z\u0600-\u06FF])',
            re.MULTILINE | re.UNICODE)),
        # Urdu
        ("urdu", re.compile(
            r'(?:^|\n)\s*سوال\s*(?:نمبر\s*)?\s*(\d{1,2})',
            re.MULTILINE | re.UNICODE)),
        # Bare number at line start (LOWEST confidence — most false positives)
        # Only used as last resort, with strict false-positive filtering
        ("num-bare", re.compile(
            r'(?:^|\n)\s*(\d{1,2})\s+(?=[A-Za-z\u0600-\u06FF])',
            re.MULTILINE | re.UNICODE)),
    ]

    for pat_name, pattern in patterns:
        matches = list(pattern.finditer(text))
        # Allow 1+ matches for high-confidence patterns (Q1 inference can make 2 from 1)
        min_matches = 1 if pat_name in ("Q-prefix", "zero-padded", "circled") else 2
        logger.info(f"Pattern '{pat_name}': found {len(matches)} matches (need {min_matches})")
        if len(matches) >= min_matches:
            result = _validate_and_build_questions(text, matches, pat_name)
            if result:
                logger.info(f"Line-scan pattern '{pat_name}': {len(result)} valid questions")
                return result

    return []


def _inline_scan_questions(text: str) -> List[Dict]:
    """Scan for question markers anywhere in text (no line-start required)."""
    patterns = [
        ("Q-inline", re.compile(r'[Qq](?:uestion)?\s*[.:\-)]?\s*(\d{1,2})', re.UNICODE)),
        ("circled-inline", re.compile(r'([\u2460-\u2469])', re.UNICODE)),
        ("zero-inline", re.compile(r'(?:^|\s)(0[1-9])\s+(?=\S)', re.UNICODE)),
        ("punct-inline", re.compile(r'(?:^|\s)(\d{1,2})\s*[.):\-]\s+(?=[A-Za-z\u0600-\u06FF])', re.UNICODE)),
        ("urdu-inline", re.compile(r'سوال\s*(?:نمبر\s*)?\s*(\d{1,2})', re.UNICODE)),
    ]

    for pat_name, pattern in patterns:
        matches = list(pattern.finditer(text))
        # Allow 1+ matches for high-confidence patterns (Q1 inference)
        min_matches = 1 if pat_name in ("Q-inline", "zero-inline", "circled-inline") else 2
        logger.info(f"Inline pattern '{pat_name}': found {len(matches)} matches (need {min_matches})")
        if len(matches) >= min_matches:
            result = _validate_and_build_questions(text, matches, pat_name)
            if result:
                logger.info(f"Inline-scan pattern '{pat_name}': {len(result)} valid questions")
                return result

    return []


def _answer_scan_questions(text: str) -> List[Dict]:
    """Detect questions by 'Ans'/'Answer' markers."""
    pattern = re.compile(r'[Aa]ns(?:wer)?\s*[.:\-)\s]*\s*(\d{1,2})', re.UNICODE)
    matches = list(pattern.finditer(text))
    if len(matches) >= 2:
        return _validate_and_build_questions(text, matches, "answer")
    return []

def parse_marks_schema(schema_text: str) -> Dict:
    """
    Parse marks schema to extract total marks and per-question marks.

    CRITICAL RULE: Only treat numbers as total marks if they appear with
    an explicit label like "Total", "Max", "Out of", "/30", etc.
    Do NOT treat "32 Give 2 advantages" as total marks = 32.
    A number followed by text is a QUESTION NUMBER, not total marks.
    """
    try:
        lines = schema_text.split('\n')
        schema_info = {
            'total_marks': 10,
            'criteria': [],
            'per_question_marks': None
        }

        total_found = False

        for line in lines:
            line = line.strip()
            line_lower = line.lower()

            # === TOTAL MARKS: Only with explicit labels ===
            # "Total: 30", "Total Marks: 30", "Max marks: 30", "Out of 30"
            total_keywords = ['total', 'max marks', 'out of', 'کل نمبر', 'کل مارکس']
            if any(keyword in line_lower for keyword in total_keywords):
                # Extract number that comes AFTER the keyword
                for kw in total_keywords:
                    if kw in line_lower:
                        after_kw = line_lower.split(kw)[-1]
                        numbers = re.findall(r'\d+', after_kw)
                        if numbers:
                            val = int(numbers[0])
                            if 1 <= val <= 500:
                                schema_info['total_marks'] = val
                                total_found = True
                                break

            # "/30" pattern (standalone or at end of line)
            slash_match = re.search(r'/\s*(\d+)\s*$', line)
            if slash_match:
                val = int(slash_match.group(1))
                if 1 <= val <= 500:
                    schema_info['total_marks'] = val
                    total_found = True

            # === PER-QUESTION MARKS ===
            # "each question 3 marks", "per question: 5", "3 marks each"
            if any(keyword in line_lower for keyword in ['each', 'per', 'ہر سوال', 'فی سوال']):
                numbers = re.findall(r'\d+', line)
                if numbers:
                    val = int(numbers[0])
                    if 1 <= val <= 50:
                        schema_info['per_question_marks'] = val

            # "Q1: 3 marks" or "Q1 (3)"
            q_marks_match = re.match(r'[Qq]\s*\d+\s*[.:)\-]\s*(\d+)\s*(?:marks?)?', line)
            if q_marks_match:
                val = int(q_marks_match.group(1))
                if 1 <= val <= 50 and schema_info['per_question_marks'] is None:
                    schema_info['per_question_marks'] = val

            if line and len(line) > 5:
                schema_info['criteria'].append(line)

        # === FALLBACK: Only use standalone "/XX" patterns, NOT bare numbers ===
        # Do NOT use bare numbers like "32" as total marks — they could be question numbers
        if not total_found:
            # Only match explicit /XX patterns
            slash_matches = re.findall(r'/\s*(\d{2,3})', schema_text)
            if slash_matches:
                candidates = [int(n) for n in slash_matches if 5 <= int(n) <= 500]
                if candidates:
                    schema_info['total_marks'] = max(candidates)
                    total_found = True

        if not total_found:
            logger.warning(f"Could not find explicit total marks in schema. Using default: {schema_info['total_marks']}")

        logger.info(f"Parsed schema: {schema_info['total_marks']} total marks, per_q={schema_info['per_question_marks']}, {len(schema_info['criteria'])} criteria lines")
        return schema_info

    except Exception as e:
        logger.error(f"Error parsing marks schema: {str(e)}")
        return {'total_marks': 10, 'criteria': [], 'per_question_marks': None}

# === Async OCR for parallel processing ===
async def extract_all_texts_parallel(
    q_paper_path: str,
    ref_path: str,
    stu_path: str,
    schema_path: Optional[str] = None
) -> Dict:
    """Extract text from all files in parallel. schema_path is optional."""
    try:
        loop = asyncio.get_event_loop()

        tasks = [
            loop.run_in_executor(executor, extract_text_with_vision, q_paper_path),
            loop.run_in_executor(executor, extract_text_with_vision, ref_path),
            loop.run_in_executor(executor, extract_text_with_vision, stu_path),
        ]
        if schema_path:
            tasks.append(loop.run_in_executor(executor, extract_text_with_vision, schema_path))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        errors = []

        def _unpack(r, label):
            if isinstance(r, tuple):
                text, err = r
                if err:
                    errors.append(f"{label}: {err}")
                return text or ""
            else:
                errors.append(f"{label}: {str(r)}")
                return ""

        q_paper_text = _unpack(results[0], "Question Paper")
        ref_text     = _unpack(results[1], "Reference")
        stu_text     = _unpack(results[2], "Student")
        schema_text  = _unpack(results[3], "Schema") if schema_path and len(results) > 3 else ""

        return {
            'q_paper_text': q_paper_text,
            'ref_text': ref_text,
            'stu_text': stu_text,
            'schema_text': schema_text,
            'errors': errors
        }

    except Exception as e:
        logger.error(f"Error in parallel text extraction: {str(e)}")
        return {
            'q_paper_text': '',
            'ref_text': '',
            'stu_text': '',
            'schema_text': '',
            'errors': [f"Parallel processing error: {str(e)}"]
        }

# === Terminal Display for OCR Debug ===
def print_extracted_text(label: str, text: str):
    """Print extracted OCR text to terminal for debugging"""
    border = "=" * 70
    print(f"\n{border}")
    print(f"  OCR EXTRACTED TEXT — {label.upper()}")
    print(f"{border}")
    if text:
        print(text)
    else:
        print("[NO TEXT EXTRACTED]")
    print(f"{border}\n")


def print_question_breakdown(label: str, questions: List[Dict]):
    """Print detected questions to terminal"""
    border = "-" * 70
    print(f"\n{border}")
    print(f"  DETECTED QUESTIONS — {label.upper()}")
    print(f"{border}")
    for q in questions:
        marks_str = f" [{q['marks']} marks]" if q.get('marks') else " [marks not specified]"
        print(f"  {q['question']}{marks_str}")
        # Show first 120 chars of the question text
        preview = q['text'][:120].replace('\n', ' ')
        print(f"    Text: {preview}...")

        # Show sub-parts if they exist
        if 'parts' in q and q['parts']:
            print(f"    Sub-parts: {len(q['parts'])} detected")
            for part in q['parts']:
                part_marks = f" [{part['marks']} marks]" if part.get('marks') else ""
                part_preview = part['text'][:80].replace('\n', ' ')
                print(f"      • {part['part']}{part_marks}: {part_preview}...")
    print(f"{border}\n")


# === Core Checking Function with Question-wise Evaluation ===
def _evaluate_part_similarity(ref_part_text: str, stu_part_text: str) -> Dict:
    """
    Evaluate similarity between reference and student part texts.
    Returns dict with similarity scores and concept/clarity ratios.
    """
    ref_concepts = split_sentences(ref_part_text)
    stu_concepts = split_sentences(stu_part_text)

    if not ref_concepts or not stu_concepts:
        return {
            'similarity': 0.0,
            'concept_ratio': 0.0,
            'clarity_ratio': 0.0
        }

    try:
        ref_emb = semantic_model.encode(ref_concepts, convert_to_tensor=True, show_progress_bar=False)
        stu_emb = semantic_model.encode(stu_concepts, convert_to_tensor=True, show_progress_bar=False)
    except Exception as e:
        logger.error(f"Encoding error in part evaluation: {str(e)}")
        return {'similarity': 0.0, 'concept_ratio': 0.0, 'clarity_ratio': 0.0}

    # Calculate per-concept scores
    concept_scores = []
    for ci, ref_concept in enumerate(ref_concepts):
        scores = util.cos_sim(ref_emb[ci], stu_emb)
        best_score = float(scores.max())
        concept_scores.append(best_score)

    avg_similarity = sum(concept_scores) / len(concept_scores) if concept_scores else 0

    # Concept ratio (rubric-based)
    if avg_similarity >= 0.55:
        concept_ratio = min(1.0, (avg_similarity - 0.30) / 0.50)
    elif avg_similarity >= 0.40:
        concept_ratio = 0.4
    else:
        concept_ratio = 0.0

    # Clarity ratio
    matched_concepts = sum(1 for s in concept_scores if s >= 0.45)
    clarity_ratio = matched_concepts / len(ref_concepts) if ref_concepts else 0

    return {
        'similarity': avg_similarity,
        'concept_ratio': concept_ratio,
        'clarity_ratio': clarity_ratio
    }


async def parse_qa_with_llm(text: str, source_label: str, expected_count: Optional[int] = None) -> List[Dict]:
    """
    Use GPT-4o-mini to intelligently extract question-answer pairs from OCR text.
    Handles ANY format: Q1, Question #1, circled ①, 1., (1), section headers, etc.
    If an answer has 'or'/'یا' alternatives, stores them as 'A || B' for max-score evaluation.
    expected_count: if provided, tells the LLM exactly how many Q&A pairs to find.
    Returns [] on failure so caller can fall back to regex.
    """
    client = AsyncOpenAI(api_key=openai_api_key)

    count_instruction = (
        f"\nQUESTION COUNT REQUIREMENT: This paper has EXACTLY {expected_count} questions "
        f"(Q1 through Q{expected_count}). You MUST find all {expected_count} answers. "
        "If a question number is garbled (e.g. 'QO' instead of 'Q10'), infer it from position "
        "and content. Do NOT stop early."
    ) if expected_count else ""

    prompt = f"""You are analyzing OCR text from an exam answer paper (a teacher's answer key / reference paper).
Extract every question-answer pair. The OCR text may be messy with garbled characters.
{count_instruction}
CRITICAL RULES:
1. Valid question number formats: Q1, Q.1, Q#1, Question 1, 1., 1), (1), circled ①②③ — all valid.
2. UNLABELED CONTENT RULE: If there is answer text BEFORE the first numbered question, it belongs to question 1. Assign it number 1.
3. ONE NUMBER = ONE QUESTION: Never split a single question's answer into multiple entries. Keep all bullet points, sub-parts, and examples inside ONE answer.
4. OR ALTERNATIVES: If an answer contains two acceptable alternatives separated by "or" / "OR" / "یا", write them as: "answer A || answer B". Do NOT create a new question number for the second alternative.
5. MERGED BLOCKS: If Q9 and Q10 answers are merged into one block, split them based on the content change (e.g., "search engine" content = Q9, "website address" content = Q10).
6. SKIP: student names, dates, exam titles, school names, roll numbers, subject/section headers.
7. Return question numbers as plain integers: 1, 2, 3 ... (not "Q1").
8. Include ALL answer content — do not truncate long answers.

OCR TEXT:
{text[:3500]}

Return ONLY a JSON array (no markdown, no extra text):
[{{"question": "1", "text": "answer text"}}, {{"question": "2", "text": "answer text"}}]"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=1500,
        )
        raw = response.choices[0].message.content.strip()
        # Strip markdown code fences if present
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return []

        result = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            q_num = str(item.get('question', '')).strip()
            q_text = str(item.get('text', '')).strip()
            if q_num.isdigit() and len(q_text) >= 3:
                result.append({
                    'question': f'Q{q_num}',
                    'text': q_text,
                    'marks': None,
                })

        if result:
            logger.info(f"LLM parsed {len(result)} Q&A pairs from {source_label}")
            print(f"\n  ✓ LLM detected {len(result)} questions from {source_label}")
            # Log each detected question for debugging
            for item in result:
                logger.info(f"  [{source_label}] {item['question']}: {item['text'][:80]}...")
        else:
            logger.warning(f"LLM returned 0 questions from {source_label}")
        return result

    except Exception as e:
        logger.warning(f"LLM parsing failed for {source_label}: {str(e)}")
        return []


async def parse_question_paper_with_llm(text: str) -> List[Dict]:
    """
    Parse question paper OCR text to extract question numbers, question text, and marks.
    Returns: [{"question": "Q1", "text": "What is file extension?", "marks": 2}, ...]
    """
    client = AsyncOpenAI(api_key=openai_api_key)

    prompt = f"""You are analyzing OCR text from an exam question paper.
Extract every question with its number, full text, and marks.

RULES:
1. Find every question number and its complete question text.
2. Extract marks per question — look for: [5], (5 marks), /5, 5 marks, (5), etc.
3. Return question numbers as plain integers: 1, 2, 3 ...
4. Include ONLY actual questions — skip exam title, date, instructions, student name fields.
5. If marks not found for a question, use null.
6. If a question has sub-parts (a, b, c or i, ii, iii), include them in the "text" field.
7. OCR MARKS ARTIFACT: OCR often garbles marks. If most questions have 3 marks but one shows [36], [30], etc. — that is an OCR error. Correct it to the consistent value (e.g., 3) or use null.
8. OR QUESTIONS: If a question offers alternatives like "Define X. OR What is Y?", separate the two alternatives in the text field with " || ". Example text: "Define X. || What is Y?"

OCR TEXT:
{text[:3500]}

Return ONLY a JSON array (no markdown, no extra text):
[{{"question": "1", "text": "What is a DoS attack?", "marks": 5}}, ...]"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=1500,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return []

        result = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            q_num = str(item.get('question', '')).strip()
            q_text = str(item.get('text', '')).strip()
            q_marks_raw = item.get('marks')

            q_marks = None
            if q_marks_raw is not None:
                try:
                    q_marks = int(float(str(q_marks_raw)))
                except (ValueError, TypeError):
                    q_marks = None

            if q_num.isdigit() and len(q_text) >= 3:
                result.append({
                    'question': f'Q{q_num}',
                    'text': q_text,
                    'marks': q_marks,
                })

        # === MARKS OUTLIER DETECTION: Fix OCR-inflated marks values ===
        known_marks = [q['marks'] for q in result if q.get('marks') is not None]
        if len(known_marks) >= 2:
            sorted_marks = sorted(known_marks)
            # Use median as reference point
            mid = len(sorted_marks) // 2
            median_m = sorted_marks[mid] if len(sorted_marks) % 2 == 1 else (sorted_marks[mid-1] + sorted_marks[mid]) / 2
            # Mode (most common value)
            mode_m = max(set(known_marks), key=known_marks.count)
            # If any mark is > 3x the median AND > 10, it's likely an OCR error
            for q in result:
                if q.get('marks') and q['marks'] > max(median_m * 3, 10) and q['marks'] != median_m:
                    logger.warning(
                        f"OCR marks artifact detected: {q['question']} has {q['marks']} marks "
                        f"(median={median_m}, mode={mode_m}). Resetting to {mode_m}."
                    )
                    print(f"\n  ⚠ OCR marks artifact: {q['question']} shows {q['marks']} marks → corrected to {mode_m}")
                    q['marks'] = int(mode_m)

        if result:
            logger.info(f"Question paper: parsed {len(result)} questions")
            for item in result:
                marks_str = f" [{item['marks']} marks]" if item.get('marks') else " [marks unknown]"
                or_flag = " [OR question]" if '||' in item.get('text', '') else ""
                logger.info(f"  {item['question']}{marks_str}{or_flag}: {item['text'][:60]}...")
        else:
            logger.warning("Question paper parsing returned 0 questions")

        return result

    except Exception as e:
        logger.warning(f"Question paper parsing failed: {str(e)}")
        return []


async def parse_exam_scheme_from_qp(text: str) -> Dict:
    """
    Parse exam-level attempt rules from question paper OCR text.
    Extracts: total_marks, attempt count, marks_per_q, section structure, minimums.
    Returns scheme dict — defaults to has_attempt_rule=False if no rule found.
    """
    client = AsyncOpenAI(api_key=openai_api_key)

    prompt = f"""You are analyzing OCR text from an exam question paper.
Extract the attempt rules and marking scheme.

Look for:
1. Total marks of the section/paper (e.g. "Total Marks: 40", "Section B: 40 marks", "Marks: 40")
2. "Attempt any N questions" / "Answer N questions" / "Attempt N" instruction
3. Marks per question (e.g. "Each question carries 4 marks", "4 marks each", "4x10=40")
4. Section names like Section B-I, B-II, Part A, Part B, Part I, Part II
5. Minimum questions from each section (e.g. "at least 2 from each part", "minimum 2 from B-I")

OCR TEXT:
{text[:2500]}

Return ONLY a valid JSON object (no markdown, no extra text):
{{"total_marks": 40, "attempt": 10, "marks_per_q": 4, "sections": {{"B-I": {{"min_attempt": 2}}, "B-II": {{"min_attempt": 2}}}}, "has_attempt_rule": true}}

Rules:
- Use null for any field not found in the text
- "has_attempt_rule" must be true ONLY if there is an explicit "attempt N" instruction
- If marks_per_q is not stated but total_marks and attempt are found, calculate it"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=400,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        scheme = json.loads(raw)

        if not isinstance(scheme, dict):
            return {"has_attempt_rule": False}

        # Calculate marks_per_q if derivable
        if not scheme.get("marks_per_q") and scheme.get("total_marks") and scheme.get("attempt"):
            try:
                scheme["marks_per_q"] = round(float(scheme["total_marks"]) / float(scheme["attempt"]), 2)
            except (TypeError, ZeroDivisionError):
                pass

        if scheme.get("has_attempt_rule"):
            logger.info(
                f"Exam scheme: total={scheme.get('total_marks')}, "
                f"attempt={scheme.get('attempt')}, marks_per_q={scheme.get('marks_per_q')}, "
                f"sections={list(scheme.get('sections', {}).keys())}"
            )
            print(
                f"\n  📋 Exam scheme detected:"
                f"\n     Total marks  : {scheme.get('total_marks')}"
                f"\n     Attempt      : {scheme.get('attempt')} questions"
                f"\n     Marks/question: {scheme.get('marks_per_q')}"
                f"\n     Sections     : {scheme.get('sections', {})}"
            )
        else:
            logger.info("No attempt rule found in question paper — standard scoring applies")

        return scheme

    except Exception as e:
        logger.warning(f"Exam scheme parsing failed: {e}")
        return {"has_attempt_rule": False}


async def _recover_missing_ref_questions(
    ref_text: str,
    qp_questions: List[Dict],
    ref_questions: List[Dict],
) -> List[Dict]:
    """
    Semantic recovery: if reference paper has fewer Q&A pairs than the question paper,
    re-query LLM specifically for the missing question numbers using question context as hints.
    Returns list of additionally found Q&A dicts, or [] if nothing recovered.
    """
    ref_nums = {q['question'] for q in ref_questions}
    missing = [q for q in qp_questions if q['question'] not in ref_nums]

    if not missing:
        return []

    missing_labels = ', '.join(q['question'] for q in missing)
    missing_context = '\n'.join(
        f"  {q['question']}: {q['text'][:120]}" for q in missing
    )

    logger.info(f"Attempting semantic recovery for missing reference answers: {missing_labels}")
    print(f"\n  ↺ Recovering missing reference answers for: {missing_labels}")

    client = AsyncOpenAI(api_key=openai_api_key)

    prompt = f"""You are analyzing OCR text from an exam reference/answer key paper.
A previous parse missed some questions. Find ONLY these specific missing answers:

MISSING QUESTIONS (use these to identify their answers in the text):
{missing_context}

IMPORTANT:
- The OCR may be garbled — question labels could appear as 'QO' (for Q10), 'Q.9', or be missing entirely.
- Use the question text above as a semantic guide to locate the correct answer block.
- If a question number is completely absent, infer from position and content.
- Return ONLY the missing questions you can find. Skip ones genuinely absent.

OCR TEXT:
{ref_text[:4000]}

Return ONLY a JSON array (no markdown):
[{{"question": "10", "text": "answer text here"}}]
If none found, return: []"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=800,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return []

        recovered = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            q_num = str(item.get('question', '')).strip()
            q_text = str(item.get('text', '')).strip()
            if q_num.isdigit() and len(q_text) >= 3:
                q_label = f'Q{q_num}'
                if q_label not in ref_nums:  # don't overwrite existing
                    recovered.append({'question': q_label, 'text': q_text, 'marks': None})
                    logger.info(f"  Recovered {q_label}: {q_text[:60]}...")

        if recovered:
            print(f"\n  ✓ Recovered {len(recovered)} missing answers: {[r['question'] for r in recovered]}")
        else:
            print(f"\n  ⚠ Could not recover answers for: {missing_labels}")

        return recovered

    except Exception as e:
        logger.warning(f"Semantic recovery failed: {str(e)}")
        return []


def _smart_align_questions(
    q_paper_questions: List[Dict],
    ref_questions: List[Dict],
    stu_questions: List[Dict]
) -> List[Tuple]:
    """
    Smart 3-layer question alignment.
    For each reference question, find the best matching student question:

    Layer 1: Question number match  (Q3 ref → Q3 student, exact)
    Layer 2: Semantic match via question paper text (what is being asked)
    Layer 3: Semantic match via reference answer text
    Layer 4: Not found → (ref_q, None, 'not_found') → zero marks

    Returns: List of (ref_q, stu_q_or_None, match_method_str)
    """
    if not ref_questions:
        return []

    # Student lookup by question number
    stu_by_num = {q['question']: q for q in stu_questions}
    qp_by_num  = {q['question']: q for q in q_paper_questions}

    # Pre-encode all student answer texts for batch similarity
    stu_texts = [_normalize_text(q['text'][:300]) for q in stu_questions]
    stu_embs  = None
    if stu_texts:
        try:
            stu_embs = semantic_model.encode(stu_texts, convert_to_tensor=True, show_progress_bar=False)
        except Exception as e:
            logger.warning(f"Could not pre-encode student texts for alignment: {e}")

    alignments: List[Tuple] = []
    used_stu_indices: set = set()

    for ref_q in ref_questions:
        q_num = ref_q['question']  # e.g. "Q3"

        # === Layer 1: Exact question number match ===
        if q_num in stu_by_num:
            stu_idx = next((i for i, q in enumerate(stu_questions) if q['question'] == q_num), None)
            alignments.append((ref_q, stu_by_num[q_num], 'number'))
            if stu_idx is not None:
                used_stu_indices.add(stu_idx)
            logger.info(f"  Aligned {q_num} → student {q_num} [NUMBER MATCH]")
            continue

        if stu_embs is None or not stu_questions:
            alignments.append((ref_q, None, 'not_found'))
            continue

        # Restrict search to unused student answers
        available = [(i, q) for i, q in enumerate(stu_questions) if i not in used_stu_indices]
        if not available:
            alignments.append((ref_q, None, 'not_found'))
            continue

        avail_indices = [i for i, _ in available]
        avail_embs   = stu_embs[avail_indices]

        # === Layer 2: Semantic via question paper text ===
        if q_num in qp_by_num:
            try:
                qp_norm = _normalize_text(qp_by_num[q_num]['text'])
                qp_emb  = semantic_model.encode([qp_norm], convert_to_tensor=True, show_progress_bar=False)
                sims    = util.cos_sim(qp_emb, avail_embs)[0]
                local_best = int(sims.argmax())
                best_sim   = float(sims[local_best])

                if best_sim >= 0.35:
                    best_idx = avail_indices[local_best]
                    alignments.append((ref_q, stu_questions[best_idx], 'semantic_qpaper'))
                    used_stu_indices.add(best_idx)
                    logger.info(f"  Aligned {q_num} → student {stu_questions[best_idx]['question']} [QPAPER SIM={best_sim:.2f}]")
                    continue
            except Exception as e:
                logger.warning(f"Semantic alignment (qpaper) failed for {q_num}: {e}")

        # === Layer 3: Semantic via reference answer ===
        try:
            ref_norm = _normalize_text(ref_q['text'][:300])
            ref_emb  = semantic_model.encode([ref_norm], convert_to_tensor=True, show_progress_bar=False)
            sims     = util.cos_sim(ref_emb, avail_embs)[0]
            local_best = int(sims.argmax())
            best_sim   = float(sims[local_best])

            if best_sim >= 0.30:
                best_idx = avail_indices[local_best]
                alignments.append((ref_q, stu_questions[best_idx], 'semantic_ref'))
                used_stu_indices.add(best_idx)
                logger.info(f"  Aligned {q_num} → student {stu_questions[best_idx]['question']} [REF SIM={best_sim:.2f}]")
                continue
        except Exception as e:
            logger.warning(f"Semantic alignment (ref) failed for {q_num}: {e}")

        # === Layer 4: Not found ===
        alignments.append((ref_q, None, 'not_found'))
        logger.info(f"  {q_num}: NOT FOUND in student paper → 0 marks")

    return alignments


def _sem_search(query_text: str, candidate_questions: List[Dict],
                candidate_embs, candidate_indices: List[int],
                threshold: float) -> Tuple[Optional[int], float]:
    """
    Find the best matching candidate for query_text via cosine similarity.
    Returns (best_global_index, best_sim) or (None, 0.0) if nothing passes threshold.
    """
    if candidate_embs is None or not candidate_indices:
        return None, 0.0
    try:
        q_emb = semantic_model.encode(
            [_normalize_text(query_text[:300])], convert_to_tensor=True, show_progress_bar=False
        )
        avail_embs = candidate_embs[candidate_indices]
        sims       = util.cos_sim(q_emb, avail_embs)[0]
        local_best = int(sims.argmax())
        best_sim   = float(sims[local_best])
        if best_sim >= threshold:
            return candidate_indices[local_best], best_sim
    except Exception as e:
        logger.warning(f"Semantic search error: {e}")
    return None, 0.0


def _keyword_fallback_ref_search(
    q_text: str, ref_questions: List[Dict], avail_idx: List[int]
) -> Optional[int]:
    """
    Keyword overlap fallback when semantic sim is too low.
    Extracts key content words from question, finds ref answer with max overlap.
    Requires at least 2 keyword matches to avoid false positives.
    """
    stopwords = {
        'the','a','an','is','in','of','to','what','why','how','which','are','for',
        'use','used','give','define','describe','explain','list','name','write'
    }
    key_words = {
        w.lower().rstrip('?.,') for w in q_text.split()
        if len(w) > 3 and w.lower() not in stopwords
    }
    if len(key_words) < 2:
        return None

    best_idx, best_overlap = None, 1  # require > 1 overlap
    for idx in avail_idx:
        text_lower = ref_questions[idx]['text'].lower()
        overlap = sum(1 for w in key_words if w in text_lower)
        if overlap > best_overlap:
            best_overlap, best_idx = overlap, idx
    return best_idx


# Domain-specific keywords that the multilingual MiniLM model embeds poorly.
# When both the QP question AND a ref answer contain the same keyword, force that ref.
FORCE_MATCH_KEYWORDS = [
    'header', 'footer', 'firewall', 'phishing', 'malware', 'cybercrime',
]


def _mandatory_keyword_ref_search(
    q_text: str, ref_questions: List[Dict], avail_idx: List[int]
) -> Optional[int]:
    """
    Force-match a ref for domain terms that embed poorly in MiniLM.
    If both the question AND a ref answer share a FORCE_MATCH_KEYWORD, use that ref.
    Returns the matched ref index, or None if no forced match applies.
    """
    q_lower = q_text.lower()
    for kw in FORCE_MATCH_KEYWORDS:
        if kw in q_lower:
            for idx in avail_idx:
                if kw in ref_questions[idx]['text'].lower():
                    return idx
    return None


def _deduplicate_qp_alternatives(qp_qs: List[Dict]) -> List[Dict]:
    """
    Remove OR alternatives that duplicate topics from other (non-OR) QP questions.

    Root cause: the QP parser occasionally assigns a topic from another question
    (e.g., "DoS attack" — Q3's topic) as an OR alternative of Q1. This causes the
    alignment to consume Q3's ref slot for Q1, leaving Q3 with reference_missing.

    Algorithm: for each OR alt, check keyword overlap against all non-OR questions.
    If ≥ 2 distinctive words overlap → the alt is a duplicate → remove it.
    If removing leaves a 1-alt OR, convert to a plain question.
    """
    stopwords = {
        'the', 'a', 'an', 'is', 'in', 'of', 'to', 'what', 'why', 'how', 'which',
        'are', 'for', 'use', 'used', 'give', 'define', 'describe', 'explain',
        'list', 'name', 'write'
    }
    non_or_qs = [q for q in qp_qs if '||' not in q.get('text', '')]
    non_or_kw = []
    for q in non_or_qs:
        kws = {
            w.lower().rstrip('?.,') for w in q['text'].split()
            if len(w) > 3 and w.lower() not in stopwords
        }
        non_or_kw.append((q['question'], kws))

    result = []
    for q in qp_qs:
        if '||' not in q.get('text', ''):
            result.append(q)
            continue
        alts = [a.strip() for a in q['text'].split('||') if a.strip()]
        clean_alts = []
        for alt in alts:
            alt_kws = {
                w.lower().rstrip('?.,') for w in alt.split()
                if len(w) > 3 and w.lower() not in stopwords
            }
            is_dup = any(
                other_q != q['question'] and len(alt_kws & other_kws) >= 2
                for other_q, other_kws in non_or_kw
            )
            if is_dup:
                logger.info(f"  QP dedup: removed alt '{alt[:40]}' from {q['question']}")
            else:
                clean_alts.append(alt)
        if len(clean_alts) == 1:
            result.append({**q, 'text': clean_alts[0]})        # convert to non-OR
        elif len(clean_alts) >= 2:
            result.append({**q, 'text': ' || '.join(clean_alts)})
        else:
            result.append(q)                                     # safety: keep original
    return result


def _question_centric_align(
    q_paper_questions: List[Dict],
    ref_questions: List[Dict],
    stu_questions: List[Dict]
) -> List[Tuple]:
    """
    QP-centric alignment — Question Paper is the ONLY ground truth.

    For each QP question:

      STEP A — Reference answer (PURE SEMANTIC, ignore ref numbers):
        • Normal questions: single semantic search, commit immediately.
        • OR questions: find ref CANDIDATES for each alternative (don't commit yet).

      STEP B — Student answer (number match vs semantic, best wins):
        • Compute coherence of number-match candidate (sim of student text vs QP question).
        • Compute best semantic match across ALL unmatched student answers.
        • Semantic overrides number match if sem_sim > num_sim + 0.15 (clearly better).
        • If number match coherence < 0.22 AND semantic ≥ 0.25 → use semantic.
        • OR: coherence checked against each alternative separately; semantic tries all alts.

      STEP C (OR only) — 3-step decision to select winning ref:
        1. Compare student's written answer against each QP alternative's text.
        2. Highest similarity = the alternative the student attempted.
        3. Commit ONLY that alternative's ref answer slot; release the rest.
           → 1 ref slot consumed per OR question regardless of alternative count.

    Returns: List of (qp_q, ref_q_or_None, stu_q_or_None, match_method, q_context_text)
    q_context_text: winning OR alternative text (not full "A || B"), or qp_q['text'] for normal.
    Evaluation loop uses qp_q['question'] for marks and display.
    """
    if not q_paper_questions:
        return []

    stu_by_num = {q['question']: q for q in stu_questions}

    # Pre-encode all ref and student texts
    ref_texts = [_normalize_text(q['text'][:300]) for q in ref_questions]
    stu_texts = [_normalize_text(q['text'][:300]) for q in stu_questions]

    ref_embs = None
    stu_embs = None
    try:
        if ref_texts:
            ref_embs = semantic_model.encode(ref_texts, convert_to_tensor=True, show_progress_bar=False)
        if stu_texts:
            stu_embs = semantic_model.encode(stu_texts, convert_to_tensor=True, show_progress_bar=False)
    except Exception as e:
        logger.warning(f"Pre-encoding failed in _question_centric_align: {e}")

    # Build OR-split expanded ref structure for accurate OR alternative matching.
    # When ref text is "DOS answer || Antivirus answer", its embedding is a blend of both
    # topics, so searching "What is antivirus?" against it gives poor similarity.
    # Splitting gives each OR part its own embedding for precise matching.
    or_split_refs: List[Dict] = []   # {'orig_idx': int, 'text': str}
    for orig_i, rq in enumerate(ref_questions):
        if '||' in rq['text']:
            parts = [p.strip() for p in rq['text'].split('||') if p.strip()]
            for part in parts:
                or_split_refs.append({'orig_idx': orig_i, 'text': part})
        else:
            or_split_refs.append({'orig_idx': orig_i, 'text': rq['text']})
    or_split_embs = None
    try:
        if or_split_refs:
            or_split_embs = semantic_model.encode(
                [_normalize_text(r['text'][:300]) for r in or_split_refs],
                convert_to_tensor=True, show_progress_bar=False
            )
    except Exception as e:
        logger.warning(f"OR-split ref encoding failed: {e}")

    alignments: List[Tuple] = []
    used_ref_indices: set = set()
    used_stu_indices: set = set()

    for qp_q in q_paper_questions:
        q_num  = qp_q['question']   # "Q4"
        q_text = qp_q['text']       # full question text

        # Detect OR alternatives in QP question text
        is_or = '||' in q_text
        qp_alternatives = [a.strip() for a in q_text.split('||')] if is_or else [q_text]

        avail_ref_idx = [i for i in range(len(ref_questions)) if i not in used_ref_indices]

        # ─────────────────────────────────────────────────────────────────────
        # STEP A: Find reference answer candidates
        # ─────────────────────────────────────────────────────────────────────
        ref_q = None
        # OR only: alt_i → (ref_global_idx, sim, split_idx) — committed in STEP C
        alt_ref_candidates: Dict[int, Tuple[int, float, Optional[int]]] = {}

        if is_or:
            # Build ref candidates for each alternative — don't commit slots yet.
            # Search against OR-split refs: each OR part in a ref has its own embedding,
            # so "What is antivirus?" correctly finds the antivirus sub-part of Ref Q3
            # instead of matching against a blended "DOS||Antivirus" full-text embedding.
            temp_avail_orig = list(avail_ref_idx)  # original ref indices available
            for i, alt_text in enumerate(qp_alternatives):
                # Map available original indices to their expanded OR-split slots
                avail_split = [
                    si for si, r in enumerate(or_split_refs) if r['orig_idx'] in temp_avail_orig
                ]
                split_idx, sim = _sem_search(
                    alt_text, or_split_refs, or_split_embs, avail_split, threshold=0.18
                )
                if split_idx is not None:
                    idx = or_split_refs[split_idx]['orig_idx']
                    alt_ref_candidates[i] = (idx, sim, split_idx)
                    # Only exclude non-OR refs from the pool; OR refs can be shared
                    # across multiple alts (STEP C will commit just one sub-part).
                    if '||' not in ref_questions[idx]['text']:
                        temp_avail_orig = [x for x in temp_avail_orig if x != idx]
                    logger.info(
                        f"  [{q_num}] OR-ref candidate alt{i+1} '{alt_text[:40]}' "
                        f"→ Ref {ref_questions[idx]['question']} (sim={sim:.2f})"
                    )
        else:
            # Priority 0: force-match for domain terms that embed poorly in MiniLM.
            mandatory_idx = _mandatory_keyword_ref_search(q_text, ref_questions, avail_ref_idx)
            if mandatory_idx is not None:
                ref_q = ref_questions[mandatory_idx]
                used_ref_indices.add(mandatory_idx)
                logger.info(
                    f"  [{q_num}] ref: mandatory keyword override → Ref {ref_q['question']}"
                )
            else:
                # Normal: semantic search with quality gate + keyword fallback
                MIN_REF_COMMIT_SIM = 0.27
                best_idx, best_sim = _sem_search(
                    q_text, ref_questions, ref_embs, avail_ref_idx, threshold=0.18
                )
                if best_idx is not None and best_sim >= MIN_REF_COMMIT_SIM:
                    ref_q = ref_questions[best_idx]
                    used_ref_indices.add(best_idx)
                    logger.info(
                        f"  [{q_num}] ref: semantic (sim={best_sim:.2f}) → Ref {ref_q['question']}"
                    )
                elif best_idx is not None:
                    # Low-confidence semantic match — try keyword fallback first
                    kw_idx = _keyword_fallback_ref_search(q_text, ref_questions, avail_ref_idx)
                    chosen_idx = kw_idx if kw_idx is not None else best_idx
                    ref_q = ref_questions[chosen_idx]
                    used_ref_indices.add(chosen_idx)
                    logger.info(
                        f"  [{q_num}] ref: {'keyword fallback' if kw_idx else 'low-sim semantic'} "
                        f"(sem={best_sim:.2f}) → Ref {ref_q['question']}"
                    )
                else:
                    logger.info(f"  [{q_num}] ref: NO MATCH (all sims below threshold)")

        # ─────────────────────────────────────────────────────────────────────
        # ─────────────────────────────────────────────────────────────────────
        # STEP B: Find student answer — compare number-match coherence vs
        #         semantic best, let semantic win when it's clearly better.
        #
        # Key insight: a number label (Q3) only proves position, not content.
        # If the semantic best match is significantly stronger, use that instead.
        # ─────────────────────────────────────────────────────────────────────
        stu_q   = None
        stu_idx = None

        # B1: Measure coherence of the number-match candidate (don't commit yet)
        num_match_idx = None
        num_match_sim = -1.0
        if q_num in stu_by_num:
            candidate_idx = next(
                (i for i, s in enumerate(stu_questions) if s['question'] == q_num), None
            )
            if candidate_idx is not None and candidate_idx not in used_stu_indices:
                num_match_idx = candidate_idx
                if stu_embs is not None:
                    try:
                        if is_or:
                            # OR: coherence = best sim across all alternatives
                            stu_emb_c = stu_embs[candidate_idx].unsqueeze(0)
                            for alt_text in qp_alternatives:
                                alt_emb = semantic_model.encode(
                                    [_normalize_text(alt_text[:300])], convert_to_tensor=True, show_progress_bar=False
                                )
                                sim = float(util.cos_sim(alt_emb, stu_emb_c)[0][0])
                                if sim > num_match_sim:
                                    num_match_sim = sim
                        else:
                            qp_emb = semantic_model.encode(
                                [_normalize_text(q_text[:300])], convert_to_tensor=True, show_progress_bar=False
                            )
                            num_match_sim = float(util.cos_sim(qp_emb, stu_embs[candidate_idx].unsqueeze(0))[0][0])
                    except Exception:
                        num_match_sim = 0.5  # encoding failed → trust number match

        # B2: Find best semantic match across all unmatched student answers
        avail_stu_idx = [i for i in range(len(stu_questions)) if i not in used_stu_indices]
        sem_match_idx = None
        sem_match_sim = -1.0
        if stu_embs is not None and avail_stu_idx:
            if is_or:
                for alt_text in qp_alternatives:
                    idx, sim = _sem_search(alt_text, stu_questions, stu_embs, avail_stu_idx, threshold=0.22)
                    if idx is not None and sim > sem_match_sim:
                        sem_match_sim, sem_match_idx = sim, idx
            else:
                sem_match_idx, sem_match_sim = _sem_search(
                    q_text, stu_questions, stu_embs, avail_stu_idx, threshold=0.22
                )

        # B3: Decision — semantic overrides number match when clearly better
        #   • Semantic must beat number match by ≥ 0.15 to override
        #   • If number match coherence < 0.22, lower bar: semantic just needs ≥ 0.25
        SEM_OVERRIDE_MARGIN = 0.15
        NUM_MIN_COHERENCE   = 0.22

        if num_match_idx is not None:
            if num_match_sim >= NUM_MIN_COHERENCE:
                if sem_match_idx is not None and (sem_match_sim - num_match_sim) >= SEM_OVERRIDE_MARGIN:
                    stu_q   = stu_questions[sem_match_idx]
                    stu_idx = sem_match_idx
                    logger.info(
                        f"  [{q_num}] student: semantic OVERRIDES number match "
                        f"(sem={sem_match_sim:.2f} > num={num_match_sim:.2f}+{SEM_OVERRIDE_MARGIN})"
                    )
                else:
                    stu_q   = stu_by_num[q_num]
                    stu_idx = num_match_idx
                    logger.info(f"  [{q_num}] student: number match (coherence={num_match_sim:.2f})")
            else:
                # Low coherence number match — prefer semantic if decent
                if sem_match_idx is not None and sem_match_sim >= 0.25:
                    stu_q   = stu_questions[sem_match_idx]
                    stu_idx = sem_match_idx
                    logger.info(
                        f"  [{q_num}] student: semantic wins over low-coherence number match "
                        f"(num={num_match_sim:.2f}, sem={sem_match_sim:.2f})"
                    )
                else:
                    stu_q   = stu_by_num[q_num]
                    stu_idx = num_match_idx
                    logger.info(
                        f"  [{q_num}] student: number match kept (low coherence={num_match_sim:.2f}, "
                        f"no better semantic)"
                    )
        elif sem_match_idx is not None:
            stu_q   = stu_questions[sem_match_idx]
            stu_idx = sem_match_idx
            logger.info(f"  [{q_num}] student: semantic only (sim={sem_match_sim:.2f})")
        else:
            logger.info(f"  [{q_num}] student: NOT FOUND")

        if stu_q is not None and stu_idx is not None:
            used_stu_indices.add(stu_idx)

        # ─────────────────────────────────────────────────────────────────────
        # STEP C (OR only): Determine which alternative student answered,
        #                   then commit ONLY that alternative's ref slot.
        # ─────────────────────────────────────────────────────────────────────
        if is_or:
            winning_alt     = 0
            winning_alt_sim = -1.0

            if stu_q is not None and stu_embs is not None and stu_idx is not None and len(qp_alternatives) > 1:
                try:
                    stu_emb = stu_embs[stu_idx].unsqueeze(0)

                    # PRIMARY: use ref-content vs student sim when all alts have ref candidates.
                    # This is more accurate than QP-alt vs student sim because it compares
                    # actual answer content — avoids wrong picks when STEP A mismatched a ref.
                    ref_content_sims: dict = {}
                    for alt_i, (ref_idx_c, _, split_idx_c) in alt_ref_candidates.items():
                        # Use the specific sub-part text (not the full "A || B" string) so
                        # each alt's embedding reflects only its own content, not the blend.
                        if split_idx_c is not None and split_idx_c < len(or_split_refs):
                            ref_sub_text = or_split_refs[split_idx_c]['text']
                        else:
                            ref_sub_text = ref_questions[ref_idx_c]['text']
                        ref_emb_c = semantic_model.encode(
                            [_normalize_text(ref_sub_text[:300])],
                            convert_to_tensor=True, show_progress_bar=False
                        )
                        ref_content_sims[alt_i] = float(util.cos_sim(ref_emb_c, stu_emb)[0][0])

                    if len(ref_content_sims) == len(qp_alternatives):
                        # All alts have ref candidates → use ref-content sim as primary decider
                        winning_alt = max(ref_content_sims, key=ref_content_sims.get)
                        winning_alt_sim = ref_content_sims[winning_alt]
                        logger.info(
                            f"  [{q_num}] OR: winner by ref-content sim → alt{winning_alt+1} "
                            f"(sims={ref_content_sims})"
                        )
                    else:
                        # Fallback: QP alt text vs student sim (ref candidates incomplete)
                        all_alt_sims: List[float] = []
                        for i, alt_text in enumerate(qp_alternatives):
                            alt_emb = semantic_model.encode(
                                [_normalize_text(alt_text[:300])], convert_to_tensor=True, show_progress_bar=False
                            )
                            sim = float(util.cos_sim(alt_emb, stu_emb)[0][0])
                            all_alt_sims.append(sim)
                            if sim > winning_alt_sim:
                                winning_alt_sim, winning_alt = sim, i
                        logger.info(
                            f"  [{q_num}] OR: winner by QP-alt sim (incomplete ref candidates) → "
                            f"alt{winning_alt+1} (sims={all_alt_sims})"
                        )
                except Exception as e:
                    logger.warning(f"  [{q_num}] OR alt detection failed: {e} → using alt1")

            # Find ref for the winning alt; retry fresh search if STEP A missed it
            winning_ref_idx = None
            winning_ref_sim = -1.0
            if winning_alt in alt_ref_candidates:
                winning_ref_idx, winning_ref_sim, _winning_split = alt_ref_candidates[winning_alt]
            else:
                # STEP A didn't find a candidate for this alt — retry with current pool
                fresh_avail = [i for i in range(len(ref_questions)) if i not in used_ref_indices]
                retry_idx, retry_sim = _sem_search(
                    qp_alternatives[winning_alt], ref_questions, ref_embs, fresh_avail, threshold=0.18
                )
                if retry_idx is not None:
                    winning_ref_idx, winning_ref_sim = retry_idx, retry_sim
                    logger.info(
                        f"  [{q_num}] OR: retry found ref for alt{winning_alt+1} (sim={retry_sim:.2f})"
                    )
                else:
                    logger.info(
                        f"  [{q_num}] OR: no ref for winning alt{winning_alt+1} → reference_missing"
                    )

            # Fix 3: Retry ref search when winning candidate has low confidence
            LOW_REF_SIM_THRESHOLD = 0.38
            if winning_ref_idx is not None and winning_ref_sim < LOW_REF_SIM_THRESHOLD:
                all_ref_idx = list(range(len(ref_questions)))  # include already-used
                retry_idx, retry_sim = _sem_search(
                    qp_alternatives[winning_alt], ref_questions, ref_embs, all_ref_idx, threshold=0.25
                )
                if retry_idx is not None and retry_sim > winning_ref_sim + 0.20:
                    used_ref_indices.discard(winning_ref_idx)
                    old_sim = winning_ref_sim
                    winning_ref_idx, winning_ref_sim = retry_idx, retry_sim
                    logger.info(
                        f"  [{q_num}] OR: ref upgraded "
                        f"(sim {old_sim:.2f} → {winning_ref_sim:.2f}) → Ref {ref_questions[winning_ref_idx]['question']}"
                    )

            if winning_ref_idx is not None:
                ref_q = ref_questions[winning_ref_idx]
                used_ref_indices.add(winning_ref_idx)
                # Strip OR from committed ref — keep only the sub-part the winning alt matched,
                # so STEP 4 concept extraction sees clean single-answer text.
                # Only strip when the ref was not upgraded (orig_idx still matches).
                if '||' in ref_q['text'] and winning_alt in alt_ref_candidates:
                    w_orig_idx, _, w_split_idx = alt_ref_candidates[winning_alt]
                    if (w_orig_idx == winning_ref_idx
                            and w_split_idx is not None
                            and w_split_idx < len(or_split_refs)):
                        ref_q = {**ref_q, 'text': or_split_refs[w_split_idx]['text']}
                logger.info(
                    f"  [{q_num}] OR: committed Ref {ref_q['question']} "
                    f"for alt{winning_alt+1} (sim={winning_ref_sim:.2f})"
                )
            else:
                logger.info(f"  [{q_num}] OR: ref_q = None → reference_missing in scoring")

        # 5th element: context text for concept extraction.
        # OR: only the winning alternative (not the full "A || B" text).
        # Normal: full question text.
        q_context_text = qp_alternatives[winning_alt] if is_or else qp_q['text']
        alignments.append((qp_q, ref_q, stu_q, 'qp_centric', q_context_text))

    return alignments


# ─────────────────────────────────────────────────────────────────────────────
# CONCEPT-BASED SCORING ENGINE
# ─────────────────────────────────────────────────────────────────────────────

# In-memory cache: (ref_text_hash) → list of concept strings
_concept_cache: Dict[str, List[str]] = {}


def _detect_paper_language(text: str) -> str:
    """
    Detect primary language of the paper/answer.
    Returns 'urdu' if >25% of alphabetic characters are Arabic/Urdu script,
    otherwise 'english'.
    """
    if not text:
        return 'english'
    urdu_chars  = sum(1 for c in text if '\u0600' <= c <= '\u06FF')
    total_alpha = sum(1 for c in text if c.isalpha())
    if total_alpha == 0:
        return 'english'
    return 'urdu' if (urdu_chars / total_alpha) > 0.25 else 'english'


def _check_answer_language(student_text: str, paper_language: str) -> Tuple[bool, str]:
    """
    Return (language_ok, penalty_reason).
    If paper is English and student answered mostly in Urdu → penalty.
    If paper is Urdu and student answered mostly in English → also flag.
    """
    if not student_text:
        return True, ""
    urdu_chars  = sum(1 for c in student_text if '\u0600' <= c <= '\u06FF')
    total_alpha = sum(1 for c in student_text if c.isalpha())
    if total_alpha == 0:
        return True, ""
    urdu_ratio = urdu_chars / total_alpha

    if paper_language == 'english' and urdu_ratio > 0.20:
        return False, f"Answer written in Urdu ({urdu_ratio:.0%} Urdu characters). English paper requires English answers."
    if paper_language == 'urdu' and urdu_ratio < 0.15:
        return False, f"Answer written in English but paper is in Urdu."
    return True, ""


async def _extract_reference_concepts(
    ref_text: str,
    question_text: str,
    max_concepts: int = 6
) -> List[str]:
    """
    Use LLM to extract key grading concepts from a reference answer.
    Each concept is a short phrase the student must cover to get marks.
    Results are cached by (ref_text + question_text) hash.
    """
    import hashlib
    cache_key = hashlib.md5((ref_text + question_text).encode('utf-8', errors='ignore')).hexdigest()
    if cache_key in _concept_cache:
        return _concept_cache[cache_key]

    client = AsyncOpenAI(api_key=openai_api_key)
    prompt = f"""You are a grading assistant. Extract the key grading concepts from this reference answer.

Question: {question_text[:200]}
Reference Answer: {ref_text[:600]}

Extract {max_concepts} key concepts/facts a student MUST mention to earn marks.
Rules:
1. Each concept = short phrase (5-15 words), self-contained
2. Focus on definitions, key facts, named examples — not phrasing
3. If a concept can be expressed many ways (e.g. "fast" / "quick" / "saves time"), write the core idea
4. Do NOT include formatting instructions or meta-comments
5. Return ONLY a JSON array of strings

Example output: ["Email stands for Electronic Mail", "used to send digital messages", "fast communication", "low cost", "can send files and images"]

Return ONLY the JSON array:"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=300,
        )
        raw = response.choices[0].message.content.strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        concepts = json.loads(raw)
        if isinstance(concepts, list) and all(isinstance(c, str) for c in concepts):
            # Filter empty/too-short
            concepts = [c.strip() for c in concepts if len(c.strip()) > 4]
            _concept_cache[cache_key] = concepts
            logger.info(f"  Extracted {len(concepts)} concepts: {concepts[:3]}...")
            return concepts
    except Exception as e:
        logger.warning(f"Concept extraction failed: {e}")

    # Fallback: split reference into sentences as crude concepts
    fallback = [s.strip() for s in split_sentences(ref_text) if len(s.strip()) > 8][:max_concepts]
    _concept_cache[cache_key] = fallback
    return fallback


def _score_concepts(
    concepts: List[str],
    student_text: str,
) -> Tuple[float, int, int]:
    """
    Check how many extracted concepts are covered in the student's answer.
    Uses per-concept semantic similarity (concept vs every sentence in student answer).

    Returns: (weighted_score 0-1, matched_count, total_count)
    """
    if not concepts or not student_text:
        return 0.0, 0, len(concepts)

    # Split student answer into sentences for fine-grained matching
    stu_sentences = [_normalize_text(s) for s in split_sentences(student_text) if len(_normalize_text(s)) > 3]
    # Also add the full student text as one unit (catches answers written in one long sentence)
    stu_sentences.append(_normalize_text(student_text[:400]))

    norm_concepts = [_normalize_text(c) for c in concepts if len(_normalize_text(c)) > 3]

    if not norm_concepts or not stu_sentences:
        return 0.0, 0, len(concepts)

    try:
        concept_embs = semantic_model.encode(norm_concepts, convert_to_tensor=True, show_progress_bar=False)
        stu_embs     = semantic_model.encode(stu_sentences, convert_to_tensor=True, show_progress_bar=False)
    except Exception as e:
        logger.warning(f"Encoding error in _score_concepts: {e}")
        return 0.0, 0, len(concepts)

    # Each concept: is it covered by ANY student sentence?
    CONCEPT_HIT_THRESHOLD = 0.35  # concept considered covered at this similarity
    matched = 0
    for ci in range(len(norm_concepts)):
        sims     = util.cos_sim(concept_embs[ci], stu_embs)[0]
        best_sim = float(sims.max())
        if best_sim >= CONCEPT_HIT_THRESHOLD:
            matched += 1

    total   = len(norm_concepts)
    ratio   = matched / total if total > 0 else 0.0

    # Non-linear scoring curve — generous with partial answers
    if ratio >= 0.80:
        score = 1.00
    elif ratio >= 0.60:
        score = 0.85
    elif ratio >= 0.40:
        score = 0.65
    elif ratio >= 0.20:
        score = 0.40
    else:
        score = 0.0

    return score, matched, total


# Grammar/short-answer question detection
_GRAMMAR_KEYWORDS = {
    "fill in", "fill-in", "choose the correct", "choose correct", "correct the",
    "identify the", "underline", "tick the", "write one word", "one word answer",
    "the blank", "blanks", "rewrite", "change to", "make a sentence",
    "use correct form", "correct form", "correct tense", "correct verb",
    "write the correct", "put in", "put the correct",
}

def _is_grammar_question(question_text: str, ref_answer: str = "") -> bool:
    """Return True if this is a short-answer grammar/vocabulary/fill-in-blank question."""
    q_lower = question_text.lower()
    for kw in _GRAMMAR_KEYWORDS:
        if kw in q_lower:
            return True
    # Short reference answer (< 35 chars) also signals fill-in / one-word type
    if ref_answer and len(ref_answer.strip()) < 35:
        return True
    return False


def _score_grammar_question(ref_text: str, stu_text: str) -> Tuple[float, int, int]:
    """
    Soft scoring for grammar / fill-in-blank / short-answer questions.
    Combines keyword overlap with semantic similarity using a lower threshold.
    Returns: (score 0-1, matched_keywords, total_keywords)
    """
    if not ref_text or not stu_text:
        return 0.0, 0, 1

    _STOPWORDS = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "to", "of", "and", "or", "in", "on", "at", "for", "it", "this", "that",
        "he", "she", "they", "we", "i", "you", "his", "her", "their", "my",
    }

    ref_lower = _normalize_text(ref_text).lower()
    stu_lower = _normalize_text(stu_text).lower()

    ref_words = [w for w in re.findall(r'\b[a-z]+\b', ref_lower)
                 if w not in _STOPWORDS and len(w) > 1]
    stu_words = set(re.findall(r'\b[a-z]+\b', stu_lower))

    if not ref_words:
        return 0.0, 0, 1

    matched = sum(1 for w in ref_words if w in stu_words)
    total   = len(ref_words)
    kw_ratio = matched / total

    # Semantic similarity with lower threshold (0.25)
    sem_score = 0.0
    try:
        ref_emb = semantic_model.encode([ref_lower[:200]], convert_to_tensor=True, show_progress_bar=False)
        stu_emb = semantic_model.encode([stu_lower[:200]], convert_to_tensor=True, show_progress_bar=False)
        sem_score = float(util.cos_sim(ref_emb, stu_emb)[0][0])
        # Map 0.25-1.0 range to 0-1 score for grammar
        if sem_score >= 0.25:
            sem_score = min((sem_score - 0.25) / 0.75, 1.0)
        else:
            sem_score = 0.0
    except Exception:
        pass

    combined = max(kw_ratio, sem_score)

    if combined >= 0.80:   score = 1.00
    elif combined >= 0.60: score = 0.85
    elif combined >= 0.40: score = 0.65
    elif combined >= 0.20: score = 0.40
    else:                  score = 0.0

    return score, matched, total


async def check_answer_paper_core(
    question_paper_path: str,
    reference_image_path: str,
    student_image_path: str,
    marks_schema_path: Optional[str] = None,
    total_marks_override: Optional[float] = None
) -> Dict:
    """
    Compare student's answer sheet against reference using question paper as alignment anchor.
    Question paper provides: question numbers, question text, marks per question.
    Marking scheme is optional — agent uses LLM knowledge when not provided.
    """
    start_time = time.time()

    try:
        missing_files = []
        if not os.path.exists(question_paper_path):
            missing_files.append(f"Question paper: {question_paper_path}")
        if not os.path.exists(reference_image_path):
            missing_files.append(f"Reference file: {reference_image_path}")
        if not os.path.exists(student_image_path):
            missing_files.append(f"Student file: {student_image_path}")
        if marks_schema_path and not os.path.exists(marks_schema_path):
            missing_files.append(f"Marks schema file: {marks_schema_path}")

        if missing_files:
            return {
                "error": "Missing files",
                "details": missing_files,
                "processing_time": time.time() - start_time
            }

        logger.info("Starting parallel text extraction...")
        extraction_start = time.time()

        text_results = await extract_all_texts_parallel(
            question_paper_path,
            reference_image_path,
            student_image_path,
            marks_schema_path  # Optional
        )

        extraction_time = time.time() - extraction_start
        logger.info(f"Text extraction completed in {extraction_time:.2f}s")

        # Warn on non-critical OCR errors (don't abort — partial text still useful)
        if text_results['errors']:
            logger.warning(f"OCR warnings: {text_results['errors']}")

        q_paper_text = text_results['q_paper_text']
        ref_text     = text_results['ref_text']
        stu_text     = text_results['stu_text']
        schema_text  = text_results['schema_text']

        if not ref_text and not stu_text:
            return {
                "error": "Text extraction failed",
                "details": text_results['errors'],
                "processing_time": time.time() - start_time
            }

        # === PRINT RAW OCR TEXT TO TERMINAL FOR DEBUGGING ===
        print_extracted_text("Question Paper (RAW OCR)", q_paper_text)
        print_extracted_text("Reference Paper (RAW OCR)", ref_text)
        print_extracted_text("Student Paper (RAW OCR)", stu_text)
        if schema_text:
            print_extracted_text("Marking Scheme (RAW OCR)", schema_text)

        # === CLEAN OCR NOISE ===
        ref_text = clean_ocr_noise(ref_text)
        stu_text = clean_ocr_noise(stu_text)
        # Don't clean schema aggressively — it may have numbers/marks we need
        schema_text = clean_ocr_noise(schema_text)

        # === DETECT PAPER LANGUAGE (from question paper) ===
        paper_language = _detect_paper_language(q_paper_text or ref_text)
        logger.info(f"Paper language detected: {paper_language}")
        print(f"\n  📄 Paper language: {paper_language.upper()}")

        # === STEP 1a: PARSE QUESTION PAPER + EXAM SCHEME IN PARALLEL ===
        print("\n  Parsing question structure and exam scheme with AI...")
        q_paper_questions_raw, exam_scheme = await asyncio.gather(
            parse_question_paper_with_llm(q_paper_text),
            parse_exam_scheme_from_qp(q_paper_text),
        )
        q_paper_questions = _deduplicate_qp_alternatives(q_paper_questions_raw)
        qp_count = len(q_paper_questions) or None  # None = no hint when QP parse fails

        # Normalize reference OCR artifacts BEFORE LLM parse
        ref_text_normalized = _normalize_reference_ocr(ref_text)
        if ref_text_normalized != ref_text:
            logger.info("Reference OCR text normalized (QO→Q10, Q.N→QN fixes applied)")

        # === STEP 1b: PARSE REF + STUDENT IN PARALLEL (with QP count hint for ref) ===
        ref_questions_llm, stu_questions_llm = await asyncio.gather(
            parse_qa_with_llm(ref_text_normalized, "Reference Paper", expected_count=qp_count),
            parse_qa_with_llm(stu_text, "Student Paper"),
        )

        # Regex fallback for ref/student
        ref_questions_regex = split_into_questions(ref_text_normalized)
        stu_questions_regex = split_into_questions(stu_text)

        ref_questions = ref_questions_llm if len(ref_questions_llm) >= len(ref_questions_regex) else ref_questions_regex
        stu_questions = stu_questions_llm if len(stu_questions_llm) >= len(stu_questions_regex) else stu_questions_regex

        # === STEP 1c: SEMANTIC RECOVERY — if ref is still short vs QP ===
        if q_paper_questions and len(ref_questions) < len(q_paper_questions):
            logger.info(
                f"Reference short: {len(ref_questions)} found vs {len(q_paper_questions)} expected — "
                "attempting semantic recovery"
            )
            recovered = await _recover_missing_ref_questions(ref_text_normalized, q_paper_questions, ref_questions)
            if recovered:
                ref_questions = ref_questions + recovered
                logger.info(f"After recovery: ref has {len(ref_questions)} answers")

        logger.info(f"Q detection — qpaper: {len(q_paper_questions)} | ref: LLM={len(ref_questions_llm)} regex={len(ref_questions_regex)} → {len(ref_questions)} | stu: LLM={len(stu_questions_llm)} regex={len(stu_questions_regex)} → {len(stu_questions)}")

        print_question_breakdown("Question Paper", q_paper_questions)
        print_question_breakdown("Reference Paper", ref_questions)
        print_question_breakdown("Student Paper", stu_questions)

        if not ref_questions:
            logger.warning("Could not detect questions in reference paper — single-block fallback")
            ref_questions = [{'question': 'Q1', 'text': ref_text, 'marks': None}]
        if not stu_questions:
            logger.warning("Could not detect questions in student paper — single-block fallback")
            stu_questions = [{'question': 'Q1', 'text': stu_text, 'marks': None}]

        # === STEP 2: MARKS RESOLUTION ===
        # Priority: exam_scheme (attempt rule) > QP sum > schema > session override > default
        schema_info = parse_marks_schema(schema_text) if schema_text else {'total_marks': 10, 'criteria': [], 'per_question_marks': None}

        qp_marks_sum   = sum(q.get('marks') or 0 for q in q_paper_questions)
        qp_marks_count = sum(1 for q in q_paper_questions if q.get('marks'))

        if exam_scheme.get("has_attempt_rule") and exam_scheme.get("total_marks"):
            # Attempt-rule paper: total = attempt × marks_per_q (not sum of all Q marks)
            total_marks = float(exam_scheme["total_marks"])
            logger.info(f"Total marks from exam scheme (attempt rule): {total_marks}")
            print(f"\n  ✓ Total marks = {total_marks} (exam scheme: attempt rule)")
        elif qp_marks_sum > 0 and qp_marks_count > 0 and not exam_scheme.get("has_attempt_rule"):
            total_marks = float(qp_marks_sum)
            logger.info(f"Total marks from question paper: {total_marks} ({qp_marks_count} questions)")
            print(f"\n  ✓ Total marks = {total_marks} (from question paper, {qp_marks_count} questions)")
        elif schema_text and schema_info.get('total_marks', 10) != 10:
            total_marks = float(schema_info['total_marks'])
            logger.info(f"Total marks from schema: {total_marks}")
            print(f"\n  ✓ Total marks = {total_marks} (from marking scheme)")
        elif total_marks_override is not None and total_marks_override > 0:
            total_marks = total_marks_override
            logger.info(f"Total marks from session override: {total_marks}")
            print(f"\n  ✓ Total marks = {total_marks} (teacher-entered)")
        else:
            total_marks = float(len(ref_questions) * 5)
            logger.warning(f"No marks source found. Defaulting to {total_marks}")
            print(f"\n  ⚠ No marks found. Defaulting to {total_marks}")

        # If attempt rule + marks_per_q known, override per-question marks in QP
        if exam_scheme.get("has_attempt_rule") and exam_scheme.get("marks_per_q"):
            mpq = float(exam_scheme["marks_per_q"])
            for qpq in q_paper_questions:
                qpq["marks"] = mpq  # force uniform marks_per_q on every question
            logger.info(f"Marks per question forced to {mpq} (exam scheme)")

        schema_info['total_marks'] = total_marks

        # Build per-question marks lookup from question paper
        qp_marks_by_num: Dict[str, float] = {}
        if q_paper_questions:
            for qpq in q_paper_questions:
                if qpq.get('marks'):
                    qp_marks_by_num[qpq['question']] = float(qpq['marks'])
            # Distribute remaining marks to questions without explicit marks
            qs_without_marks = [q for q in ref_questions if q['question'] not in qp_marks_by_num]
            allocated = sum(qp_marks_by_num.values())
            if qs_without_marks and allocated < total_marks:
                per_remaining = (total_marks - allocated) / len(qs_without_marks)
                for q in qs_without_marks:
                    qp_marks_by_num[q['question']] = per_remaining

        if qp_marks_by_num:
            print(f"\n  ✅ Per-question marks from question paper: {qp_marks_by_num}")
        else:
            print(f"\n  ⚠ No per-question marks found in question paper — distributing {total_marks} equally")

        # === STEP 3: QUESTION-CENTRIC ALIGNMENT ===
        logger.info("Running question-centric alignment...")
        if q_paper_questions:
            alignments = _question_centric_align(q_paper_questions, ref_questions, stu_questions)
        else:
            # Fallback: no question paper → old ref-centric alignment
            logger.warning("No question paper questions detected — falling back to ref-centric alignment")
            old_alignments = _smart_align_questions(q_paper_questions, ref_questions, stu_questions)
            # Wrap into 5-tuple format: (qp_q_stub, ref_q, stu_q, method, q_context_text)
            alignments = [
                ({'question': a[0]['question'], 'text': '', 'marks': None},
                 a[0], a[1], a[2], a[0].get('text', ''))
                for a in old_alignments
            ]

        # === STEP 4: PRE-EXTRACT CONCEPTS FOR ALL QUESTIONS (parallel LLM calls) ===
        # ref_q is always a single answer (STEP C committed the winning OR alternative),
        # so concept extraction is uniform: one call per question.
        logger.info("Pre-extracting reference concepts for all questions...")
        concept_tasks = []
        for qp_q_a, ref_q_a, _, _, q_ctx in alignments:
            if ref_q_a:
                ref_text_for_concepts = ref_q_a['text']
                # If the committed ref answer itself contains OR alternatives (e.g., "A || B"),
                # pick only the part closest to the winning QP alternative context.
                # This prevents concept extraction from mixing both alternatives and penalising
                # students who correctly answered just one of them.
                if '||' in ref_text_for_concepts and q_ctx:
                    ref_parts = [p.strip() for p in ref_text_for_concepts.split('||') if p.strip()]
                    if len(ref_parts) >= 2:
                        try:
                            ctx_emb = semantic_model.encode(
                                [_normalize_text(q_ctx[:200])], convert_to_tensor=True, show_progress_bar=False
                            )
                            part_embs = semantic_model.encode(
                                [_normalize_text(p[:200]) for p in ref_parts],
                                convert_to_tensor=True, show_progress_bar=False
                            )
                            sims = util.cos_sim(ctx_emb, part_embs)[0]
                            best_part = ref_parts[int(sims.argmax())]
                            ref_text_for_concepts = best_part
                            logger.info(
                                f"  [{qp_q_a['question']}] OR ref split: using part '{best_part[:50]}'"
                            )
                        except Exception:
                            pass  # keep full text on error
                concept_tasks.append(_extract_reference_concepts(ref_text_for_concepts, q_ctx))
            else:
                async def _empty():
                    return []
                concept_tasks.append(_empty())

        all_raw_concepts = await asyncio.gather(*concept_tasks)
        all_concepts: List = list(all_raw_concepts)

        # === STEP 5: EVALUATION LOOP (concept-based scoring) ===
        logger.info("Starting concept-based evaluation...")
        encoding_start = time.time()

        total_marks_earned = 0.0
        question_results   = []
        marks_accounted    = 0.0
        _equal_per_q       = round(total_marks / len(alignments), 2) if alignments else 0

        for idx, alignment in enumerate(alignments):
            # 5-tuple: (qp_q, ref_q_or_None, stu_q_or_None, match_method, q_context_text)
            qp_q, ref_q, stu_q, match_method, q_context_text = alignment
            display_q     = qp_q['question']
            is_or_question = '||' in qp_q.get('text', '')

            # Marks lookup — QP number is ground truth
            q_marks = float(
                qp_marks_by_num.get(display_q)
                or (ref_q.get('marks') if ref_q else None)
                or schema_info.get('per_question_marks')
                or _equal_per_q
            )
            marks_accounted += q_marks
            marks_src = 'qpaper' if qp_marks_by_num.get(display_q) else f'equal({_equal_per_q})'
            print(f"  {display_q}: {q_marks} marks (source: {marks_src}){' [OR]' if is_or_question else ''}")

            # === NOT ATTEMPTED ===
            if stu_q is None:
                question_results.append({
                    "question": display_q, "marks_obtained": 0, "marks_total": q_marks,
                    "type": "not_attempted",
                    "reason": f"{display_q} not found in student paper.",
                    "concepts_matched": "0/0", "alignment": match_method,
                })
                print(f"  {display_q}: 0/{q_marks} marks (not attempted)")
                continue

            if not stu_q.get('text', '').strip():
                question_results.append({
                    "question": display_q, "marks_obtained": 0, "marks_total": q_marks,
                    "type": "missing_answer",
                    "reason": f"No answer written for {display_q}.",
                    "concepts_matched": "0/0", "alignment": match_method,
                })
                continue

            # === NO REFERENCE ===
            if ref_q is None:
                question_results.append({
                    "question": display_q, "marks_obtained": 0, "marks_total": q_marks,
                    "type": "reference_missing",
                    "reason": "No reference answer found. Teacher review required.",
                    "concepts_matched": "0/0", "alignment": match_method,
                })
                print(f"  {display_q}: 0/{q_marks} (reference_missing)")
                continue

            # === LANGUAGE CHECK ===
            lang_ok, lang_reason = _check_answer_language(stu_q['text'], paper_language)
            lang_penalty = 1.0 if lang_ok else 0.5

            # === CONCEPT SCORING ===
            raw_concepts = all_concepts[idx]
            stu_text_for_scoring = stu_q['text']
            ref_text_for_scoring = ref_q['text'] if ref_q else ""
            qp_q_text = qp_q.get('text', '')

            # Detect grammar / fill-in-blank / short-answer question
            _is_grammar_q = _is_grammar_question(qp_q_text, ref_text_for_scoring)

            if _is_grammar_q:
                # Use soft keyword+semantic scorer for grammar questions
                weighted_score, matched_n, total_n = _score_grammar_question(
                    ref_text_for_scoring, stu_text_for_scoring
                )
                logger.info(f"  [{display_q}] grammar scoring: score={weighted_score:.2f} ({matched_n}/{total_n} keywords)")
                print(f"  {display_q}: grammar question → score={weighted_score:.2f}")
            else:
                # Standard concept-based scoring for longer answers
                concepts_list = raw_concepts if raw_concepts else []
                weighted_score, matched_n, total_n = _score_concepts(concepts_list, stu_text_for_scoring)

            # Ensure concepts_list is always defined (used by heading guard + fallbacks below)
            if _is_grammar_q:
                concepts_list = []  # fallbacks not needed for grammar questions

            or_note = " (OR question)" if is_or_question else ""

            # Compute direct ref↔student similarity unconditionally (used by both fallbacks).
            direct_sim = -1.0
            if ref_q and stu_q:
                try:
                    ref_emb_fb = semantic_model.encode(
                        [_normalize_text(ref_q['text'][:300])],
                        convert_to_tensor=True, show_progress_bar=False
                    )
                    stu_emb_fb = semantic_model.encode(
                        [_normalize_text(stu_q['text'][:300])],
                        convert_to_tensor=True, show_progress_bar=False
                    )
                    direct_sim = float(util.cos_sim(ref_emb_fb, stu_emb_fb)[0][0])
                except Exception:
                    pass

            # === HEADING KEYWORD GUARD ===
            # If the student's primary assigned answer starts with a topic-heading
            # (e.g. "ANTIVIRUS:", "DOS ATTACK:", "EMAIL:") that is semantically related
            # to the CURRENT question's topic, the alignment is confirmed correct.
            # Fallback A must NOT fire — the problem is concept extraction failing,
            # not wrong answer assignment.
            _heading_match = False
            _heading_keyword = None
            if stu_q and stu_q.get('text') and q_context_text:
                _first_line = stu_q['text'].split('\n')[0].strip()
                _h = re.match(r'^([A-Z][A-Za-z\s\-]{2,30}):', _first_line)
                if _h:
                    _heading_keyword = _h.group(1).strip()
                    # Semantic check: heading vs question topic
                    try:
                        _h_emb = semantic_model.encode(
                            [_normalize_text(_heading_keyword)],
                            convert_to_tensor=True, show_progress_bar=False
                        )
                        _q_emb = semantic_model.encode(
                            [_normalize_text(q_context_text[:150])],
                            convert_to_tensor=True, show_progress_bar=False
                        )
                        _h_sim = float(util.cos_sim(_h_emb, _q_emb)[0][0])
                        if _h_sim >= 0.35:
                            _heading_match = True
                            logger.info(
                                f"  [{display_q}] heading-guard: '{_heading_keyword}' matches question topic "
                                f"(sim={_h_sim:.2f}) → primary answer confirmed correct, adj-answer fallback suppressed"
                            )
                    except Exception:
                        pass

            # When heading confirms correct alignment but concept scoring still fails,
            # boost concept matching by using the heading as an anchor concept.
            if _heading_match and weighted_score == 0.0 and concepts_list and _heading_keyword:
                try:
                    _stu_sents = [
                        _normalize_text(s) for s in split_sentences(stu_q['text'])
                        if len(_normalize_text(s)) > 3
                    ]
                    _stu_sents.append(_normalize_text(stu_q['text'][:400]))
                    # Add heading as anchor concept
                    _boosted_concepts = [_normalize_text(_heading_keyword)] + [
                        _normalize_text(c) for c in concepts_list if len(_normalize_text(c)) > 3
                    ]
                    if _boosted_concepts and _stu_sents:
                        _cembs = semantic_model.encode(_boosted_concepts, convert_to_tensor=True, show_progress_bar=False)
                        _sembs = semantic_model.encode(_stu_sents, convert_to_tensor=True, show_progress_bar=False)
                        _matched_r = sum(
                            1 for ci in range(len(_boosted_concepts))
                            if float(util.cos_sim(_cembs[ci], _sembs)[0].max()) >= 0.30
                        )
                        _ratio_r = _matched_r / len(_boosted_concepts)
                        if _ratio_r >= 0.20:
                            if _ratio_r >= 0.80:   weighted_score = 1.00
                            elif _ratio_r >= 0.60: weighted_score = 0.85
                            elif _ratio_r >= 0.40: weighted_score = 0.65
                            else:                  weighted_score = 0.40
                            logger.info(
                                f"  [{display_q}] heading-guard rescore: "
                                f"{_matched_r}/{len(_boosted_concepts)} concepts (heading-boosted) → score={weighted_score:.2f}"
                            )
                except Exception:
                    pass

            # Fallback A: Misalignment — committed student slot has wrong content.
            # Only trigger when direct_sim < 0.30: the ref matched this question well,
            # but the student slot's text is unrelated → student's answer is in another slot.
            # Suppressed when heading-guard confirms the primary answer is correct.
            if weighted_score == 0.0 and direct_sim < 0.30 and concepts_list and stu_questions and not _heading_match:
                try:
                    q_num_int = int(''.join(filter(str.isdigit, display_q)))
                    for delta in (-1, +1, -2, +2):
                        adj_q_str = f"Q{q_num_int + delta}"
                        adj_stu = next(
                            (s for s in stu_questions if s['question'] == adj_q_str), None
                        )
                        if adj_stu and adj_stu.get('text', '').strip():
                            adj_score, _, _ = _score_concepts(concepts_list, adj_stu['text'])
                            if adj_score > 0.20:
                                # Validate: adjacent answer must be semantically related to
                                # THIS question's ref — prevents using Q2's answer for Q3
                                # when topics are completely different.
                                adj_ref_sim = 0.0
                                if ref_q:
                                    try:
                                        ref_emb_adj = semantic_model.encode(
                                            [_normalize_text(ref_q['text'][:300])],
                                            convert_to_tensor=True, show_progress_bar=False
                                        )
                                        adj_emb = semantic_model.encode(
                                            [_normalize_text(adj_stu['text'][:300])],
                                            convert_to_tensor=True, show_progress_bar=False
                                        )
                                        adj_ref_sim = float(util.cos_sim(ref_emb_adj, adj_emb)[0][0])
                                    except Exception:
                                        pass
                                if adj_ref_sim >= 0.40 and adj_score >= 0.30:
                                    weighted_score = adj_score
                                    logger.info(
                                        f"  [{display_q}] adj-answer fallback: used {adj_q_str} "
                                        f"(ref_sim={adj_ref_sim:.2f}, score={adj_score:.3f})"
                                    )
                                    break
                                else:
                                    logger.info(
                                        f"  [{display_q}] adj-answer fallback: {adj_q_str} rejected "
                                        f"(ref_sim={adj_ref_sim:.2f}, concept_score={adj_score:.3f} "
                                        f"— needs ref_sim>=0.40 AND score>=0.30)"
                                    )
                except Exception:
                    pass

            # Fallback B: Phrasing mismatch — answer is there but concepts didn't fire.
            # direct_sim >= 0.38 means content is semantically close → min partial credit.
            if weighted_score == 0.0 and direct_sim >= 0.38:
                weighted_score = 0.20
                logger.info(
                    f"  [{display_q}] concept fallback: direct_sim={direct_sim:.2f} → score=0.20"
                )

            # Apply language penalty
            weighted_score = round(weighted_score * lang_penalty, 4)

            q_earned = round(min(q_marks * weighted_score, q_marks), 2)
            total_marks_earned += q_earned

            # Feedback
            if not lang_ok:
                fb_type   = "language_error"
                fb_reason = lang_reason
            elif weighted_score >= 0.85:
                fb_type, fb_reason = "success",          "Good answer — key concepts covered well."
            elif weighted_score >= 0.65:
                fb_type, fb_reason = "partial_match",    "Partial answer — some key concepts missing."
            elif weighted_score >= 0.40:
                fb_type, fb_reason = "weak_match",       "Weak answer — important concepts not covered."
            else:
                fb_type, fb_reason = "missing_concept",  "Answer does not address the required concepts."

            question_results.append({
                "question":         display_q,
                "marks_obtained":   q_earned,
                "marks_total":      q_marks,
                "type":             fb_type,
                "reason":           fb_reason + or_note,
                "concepts_matched": f"{matched_n}/{total_n}",
                "concept_score":    round(weighted_score, 3),
                "language_ok":      lang_ok,
                "alignment":        match_method,
            })

            lang_flag = f" ⚠ LANG:{lang_reason[:40]}" if not lang_ok else ""
            print(f"  {display_q}: {q_earned}/{q_marks} marks "
                  f"(concepts={matched_n}/{total_n}, score={weighted_score:.2f}){or_note}{lang_flag}")

        encoding_time = time.time() - encoding_start

        # === STEP 5b: BEST-N SELECTION (if "Attempt N" rule exists) ===
        if exam_scheme.get("has_attempt_rule") and exam_scheme.get("attempt"):
            attempt_n = int(exam_scheme["attempt"])
            attempted = [r for r in question_results if r.get("type") not in ("not_attempted", "missing_answer")]

            if len(attempted) > attempt_n:
                # Sort by marks_obtained descending, keep best N
                attempted_sorted = sorted(attempted, key=lambda x: x.get("marks_obtained", 0), reverse=True)
                kept_questions   = {r["question"] for r in attempted_sorted[:attempt_n]}
                dropped_questions = [r["question"] for r in attempted_sorted[attempt_n:]]

                # Zero out dropped questions in-place
                for r in question_results:
                    if r["question"] in dropped_questions:
                        r["marks_obtained"] = 0.0
                        r["type"]   = "dropped_best_n"
                        r["reason"] = (
                            f"Student attempted extra questions — dropped (best {attempt_n} kept)."
                        )

                # Recalculate total from kept only
                total_marks_earned = sum(
                    r.get("marks_obtained", 0) for r in question_results
                    if r["question"] in kept_questions
                )
                print(
                    f"\n  📊 Best-N: {len(attempted)} attempted → kept best {attempt_n}"
                    f" | dropped: {dropped_questions}"
                )
                logger.info(
                    f"Best-N selection: {len(attempted)} attempted, kept {attempt_n}, "
                    f"dropped {dropped_questions}"
                )
            elif len(attempted) < attempt_n:
                logger.warning(
                    f"Student attempted only {len(attempted)} of required {attempt_n} questions"
                )
                print(
                    f"\n  ⚠ Student attempted {len(attempted)} questions, required {attempt_n}"
                )

        total_marks_earned = max(0, round(total_marks_earned, 2))
        # Ensure we don't exceed total marks
        total_marks_earned = min(total_marks_earned, total_marks)
        processing_time = time.time() - start_time

        # Print final summary to terminal
        print(f"\n{'=' * 70}")
        print(f"  FINAL RESULT: {total_marks_earned}/{total_marks} ({round((total_marks_earned / total_marks) * 100, 2)}%)")
        print(f"  Questions evaluated: {len(question_results)}")
        print(f"  Processing time: {processing_time:.2f}s")
        print(f"{'=' * 70}\n")

        logger.info(f"Total processing time: {processing_time:.2f}s")

        result = {
            "success": True,
            "marks_obtained": total_marks_earned,
            "total_marks": total_marks,
            "percentage": round((total_marks_earned / total_marks) * 100, 2),
            "feedback": question_results if question_results else [{
                "type": "success",
                "reason": "Excellent! Answer closely matches the reference.",
                "deduction": 0
            }],
            "statistics": {
                "reference_questions": len(ref_questions),
                "student_questions": len(stu_questions),
                "questions_evaluated": len(question_results),
                "reference_concepts": sum(int(r.get("concepts_matched", "0/0").split("/")[-1]) for r in question_results),
                "student_sentences": sum(int(r.get("concepts_matched", "0/0").split("/")[0]) for r in question_results),
                "text_extraction_time": round(extraction_time, 2),
                "encoding_time": round(encoding_time, 2),
                "total_processing_time": round(processing_time, 2)
            },
            "reference_text": ref_text[:500] + "..." if len(ref_text) > 500 else ref_text,
            "student_text": stu_text[:500] + "..." if len(stu_text) > 500 else stu_text,
            "schema_info": schema_info
        }

        return result

    except Exception as e:
        logger.error(f"Unexpected error in check_answer_paper_core: {str(e)}")
        return {
            "error": "Unexpected error occurred",
            "details": str(e),
            "processing_time": time.time() - start_time
        }


# === Tool Wrapper for Agent ===
@function_tool
async def check_answer_paper(question_paper_path: str, reference_image_path: str, student_image_path: str, marks_schema_path: Optional[str] = None) -> str:
    """
    Compare student's answer sheet with reference answer sheet.
    Question paper provides question numbers, text, and marks.
    Marking scheme is optional — uses LLM knowledge when not provided.
    Returns marks and detailed feedback.
    """
    result = await check_answer_paper_core(question_paper_path, reference_image_path, student_image_path, marks_schema_path)

    if "error" in result:
        return f"Error: {result['error']}\nDetails: {result.get('details', 'No additional details')}"

    output = []
    output.append("=" * 60)
    output.append("ANSWER EVALUATION RESULT")
    output.append("=" * 60)
    output.append(f"Marks Obtained: {result['marks_obtained']} / {result['total_marks']}")
    output.append(f"Percentage: {result['percentage']}%")
    output.append(f"Processing Time: {result['statistics']['total_processing_time']}s\n")

    output.append("DETAILED FEEDBACK:")
    output.append("-" * 60)
    for feedback in result['feedback']:
        if feedback['type'] == 'success':
            output.append(f"[OK] {feedback['reason']}")
        else:
            output.append(f"[DEDUCTION] [{feedback['type']}] -{feedback.get('deduction', 0)} marks")
            output.append(f"   {feedback['reason']}")
            output.append(f"   Similarity: {feedback.get('similarity_score', 0)}")
            output.append("")

    output.append("\n" + "=" * 60)
    stats = result['statistics']
    if 'reference_questions' in stats:
        output.append(f"Analysis: {stats.get('questions_evaluated', 0)} questions evaluated (ref: {stats['reference_questions']}, student: {stats['student_questions']})")
    else:
        output.append(f"Analysis: {stats['reference_concepts']} key concepts checked")
    output.append("=" * 60)

    return "\n".join(output)

# === Agent Definition ===
agent = Agent(
    name="answer_checker",
    instructions="""You are a fair, accurate, and balanced exam paper evaluator for school teachers. You evaluate student answer sheets by comparing them against a reference (model) answer and a marking scheme.

## YOUR CORE TASK
Use the check_answer_paper tool to evaluate the student's paper, then produce a clear, structured evaluation report.

## HANDLING COLUMN-BASED LAYOUTS (CRITICAL - READ CAREFULLY)

Students sometimes write answers in TWO COLUMNS separated by a vertical line:
```
Left Column:           | Right Column:
Point 1: Local trade   | Point 2: International trade
is buying and selling  | is trade between
within same country    | different countries
```

**OCR Problem:** OCR reads LEFT-TO-RIGHT horizontally, merging both columns:
```
OCR Output: "Point 1: Local trade Point 2: International trade is buying and selling is trade between within same country different countries"
```

**Your Job - Detect and Reconstruct:**

1. **Detection Pattern:** Look for these signs of merged columns:
   - Two different topics/concepts appearing alternately in the same text
   - Repeated sentence starts (e.g., "Local trade is... International trade is... Local trade... International trade...")
   - Text that doesn't flow logically when read sequentially

2. **Reconstruction:** When you detect merged columns:
   - Identify where Topic A text is vs Topic B text
   - Group Topic A sentences together, Topic B sentences together
   - Example: "Local trade. International trade. Local trade is... International trade is..."
     → Reconstruct as: "Local trade. Local trade is..." (Point 1) + "International trade. International trade is..." (Point 2)

3. **Evaluation:** Evaluate EACH reconstructed point separately against the reference

4. **DO NOT PENALIZE** the student for OCR reading order - focus on the ACTUAL CONTENT they wrote

**Common Question Pattern:**
- Q: "Give 2 advantages of trade"
- Student writes: Advantage 1 | Advantage 2 (in columns)
- OCR reads: Mixed text with both advantages jumbled
- YOU: Separate them mentally and evaluate each advantage

## CRITICAL RULES — READ CAREFULLY

### 1. ONLY EVALUATE VISIBLE QUESTIONS
- Only evaluate questions that are ACTUALLY VISIBLE in the student's paper.
- Do NOT assume, fabricate, or create extra questions that are not in the student's paper.
- If the student paper shows 2 questions, evaluate ONLY 2 questions — even if the reference has more.
- If you cannot clearly read a question, note it as "unclear/illegible" rather than guessing.

### 2. READ MARKS FROM THE PAPER — DO NOT ASSUME
- Read the per-question marks written on the paper (e.g., "Q1 [3 marks]", "(5)", "/3").
- Do NOT assume equal distribution. If 3 questions exist in a 30-mark paper, they are NOT automatically 10 marks each.
- Only use equal distribution as a LAST RESORT when no marks information exists anywhere.

### 3. CONCEPT-BASED GRADING (NOT WORD MATCHING)
- If the student's core idea/concept matches the reference meaning, award marks — even if the grammar is poor or wording is different.
- A student writing "transport help move things from maker to buyer" conveys the same concept as "transportation facilitates the movement of goods from producers to consumers."
- Do NOT penalize for grammar, spelling, or simplified language if the concept is correct.

### 4. RUBRIC-BASED MARKING
Use this rubric for each question:
| Criteria      | Weight |
|---------------|--------|
| Concept correct | 70%  |
| Clarity         | 20%  |
| Grammar         | 10%  |

This means: if the concept is correct (70% weight), the student should get the majority of marks even with weak grammar.

### 5. FAIR PARTIAL CREDIT
- Partial understanding = partial marks (not zero).
- If a student covers 2 out of 3 key points, give proportional marks.
- Zero marks ONLY for completely irrelevant or blank answers.

### 6. NEVER EXCEED TOTAL MARKS
- Marks obtained can NEVER be greater than total marks.

## REMARKS FORMAT
Write remarks in this exact structure:

**Overall Performance:** [One line summary — e.g., "Good understanding of core concepts but weak in application questions"]

**Question-wise Feedback:**
- Q1 (X/Y marks): [Specific feedback about what was correct/incorrect]
- Q2 (X/Y marks): [Specific feedback]
- ... (ONLY for questions that exist in the student paper)

**Areas to Improve:** [2-3 specific, actionable points]

## REMARKS GUIDELINES
- Write ALL remarks in clear, simple **English** — even for Urdu, Arabic, or other language papers
- Be SPECIFIC — say "Student confused mitosis with meiosis" NOT "Answer was incorrect"
- Reference what the student actually wrote vs what was expected
- For Urdu/Arabic papers: translate key terms to English in your remarks
- Keep remarks teacher-friendly — avoid technical jargon about AI/similarity scores
- Be honest but constructive — acknowledge what is correct before pointing out mistakes

## WHAT NOT TO DO
- Do NOT fabricate or assume questions that don't exist in the student paper
- Do NOT assume equal marks distribution — read from paper
- Do NOT treat grammar/spelling mistakes as concept errors
- Do NOT give zero for answers where the core idea is present but poorly worded
- Do NOT give generic feedback like "Good job" or "Keep trying" without specifics
- Do NOT ignore the marking scheme and make up your own criteria
""",
    tools=[check_answer_paper],
    model="gpt-4o-mini"
)

# === Function to run agent ===
async def evaluate_answer_papers(
    question_paper_path: str,
    reference_path: str,
    student_path: str,
    schema_path: Optional[str] = None,
    total_marks: Optional[float] = None
) -> Dict:
    """
    Run the agent to evaluate answer papers with comprehensive error handling.
    question_paper_path: required — provides Q numbers, text, marks.
    schema_path: optional — uses LLM knowledge when not provided.
    Returns the complete result with marks and feedback.
    """
    try:
        logger.info(f"Starting evaluation: {reference_path}, {student_path}, {schema_path}")

        schema_line = f"Marking scheme file: {schema_path}" if schema_path else "Marking scheme: Not provided — use your subject knowledge to evaluate"
        result = await Runner.run(
            agent,
            input=(
                f"Evaluate this student's answer paper FAIRLY.\n\n"
                f"Question paper file: {question_paper_path}\n"
                f"Reference answer file: {reference_path}\n"
                f"Student answer file: {student_path}\n"
                f"{schema_line}\n"
                f"Total marks: {total_marks if total_marks else 'Read from question paper'}\n\n"
                f"CRITICAL INSTRUCTIONS:\n"
                f"1. The question paper tells you EXACTLY what each question asks and how many marks it carries.\n"
                f"2. Match each student answer to the correct question by number first, then by semantic meaning.\n"
                f"3. If the student's CORE CONCEPT matches the reference, award marks even if grammar is weak.\n"
                f"4. Use rubric: Concept=70%, Clarity=20%, Grammar=10%.\n"
                f"5. Give partial marks for partial understanding — zero ONLY for blank or completely irrelevant answers.\n"
                f"6. Write all remarks in English even if the paper is in Urdu or another language.\n"
                f"7. If no marking scheme: use the question text + reference answer + your subject knowledge to evaluate.\n"
                f"8. Provide question-wise marks breakdown for ALL questions in the question paper."
            )
        )

        detailed_result = await check_answer_paper_core(
            question_paper_path,
            reference_path,
            student_path,
            schema_path,
            total_marks_override=total_marks
        )

        if "error" in detailed_result:
            logger.error(f"Evaluation failed: {detailed_result['error']}")
            return detailed_result

        detailed_result['agent_output'] = result.final_output
        logger.info("Evaluation completed successfully")

        return detailed_result

    except Exception as e:
        logger.error(f"Error in evaluate_answer_papers: {str(e)}")
        return {
            "error": "Agent execution failed",
            "details": str(e)
        }

# === Main function for testing ===
async def main():
    """Test function - only runs when executed directly"""
    agent_dir = Path(__file__).parent
    reference_image = agent_dir / "reference.jpg"
    student_image = agent_dir / "student.jpg"
    schema_image = agent_dir / "schema.jpg"

    if not all([reference_image.exists(), student_image.exists(), schema_image.exists()]):
        print("Test images not found. Please add reference.jpg, student.jpg, and schema.jpg")
        return

    result = await evaluate_answer_papers(
        str(reference_image),
        str(student_image),
        str(schema_image)
    )

    if "error" in result:
        print(f"\nError: {result['error']}")
        print(f"Details: {result.get('details', 'None')}")
        return

    print("\n" + "=" * 70)
    print("EVALUATION RESULT")
    print("=" * 70)
    print(f"Marks: {result['marks_obtained']}/{result['total_marks']} ({result['percentage']}%)")
    print(f"Processing Time: {result['statistics']['total_processing_time']}s")
    print("\nAgent Output:")
    print("-" * 70)
    print(result['agent_output'])
    print("=" * 70)

if __name__ == "__main__":
    asyncio.run(main())
