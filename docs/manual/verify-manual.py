from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from pathlib import Path
import json
import re
import shutil
import struct

import fitz
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
PRODUCT = ROOT / "docs" / "product"
MANIFEST_PATH = (
    ROOT
    / "docs"
    / "evidence"
    / "ether-4.0-recovery"
    / "phase-5"
    / "manual-packaged"
    / "packaged"
    / "manifest.json"
)
PDF_PATH = PRODUCT / "ether-4.0-user-manual.pdf"
RENDER_DIRECTORY = ROOT / "tmp" / "pdfs" / "ether-4.0-manual"
EXPECTED_LABELS = [
    "first-run",
    "shortcuts",
    "direct-editing",
    "all-17-nodes",
    "channels-roles",
    "locked-module",
    "reference-setup",
    "batch-run",
    "review-empty",
    "export-setup",
    "provider-guard",
    "recipes",
    "recovery-settings",
]
REQUIRED_BOOKMARKS = {
    "Ether 4.0 User Manual",
    "Start safely",
    "Workspaces",
    "Documents, references, and recovery",
    "Canvas, nodes, connections, and Inspector",
    "Run plans, batches, and Job Center",
    "Review, collections, and export",
    "Providers and intelligent work",
    "Recipes and Codex plugin",
    "Settings, accessibility, and privacy",
}
REQUIRED_TEXT = (
    "ETHER by DreamBay",
    "Build",
    "Focus",
    "Run",
    "Review",
    "17 canonical",
    "Batch Matrix",
    "Job Center",
    "Artifact Observatory",
    "Nano Banana 2",
    "Inspect",
    "Edit Permit",
    "Run Permit",
    "legacy Ether folder projects",
    "Node, channel, and role flow",
    "Recovery decision flow",
    "Start in three moves",
    "Keyboard and pointer reference",
)


def fail(message: str) -> None:
    raise SystemExit(message)


def load_manifest() -> dict:
    if not MANIFEST_PATH.is_file():
        fail("Recovery capture manifest is missing.")
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"Recovery capture manifest is unreadable: {error}")
    if not isinstance(manifest, dict):
        fail("Recovery capture manifest must be an object.")
    if (
        manifest.get("schemaVersion") != 1
        or
        manifest.get("version") != "4.0.0"
        or manifest.get("source") != "packaged-blank-document-journeys"
        or manifest.get("sourceProfile") != "fresh-isolated"
    ):
        fail("Manifest must identify the isolated packaged blank-document journeys.")
    if manifest.get("labels") != EXPECTED_LABELS:
        fail("Manifest labels do not match the T25 capture inventory.")
    captures = manifest.get("captures")
    if not isinstance(captures, list) or len(captures) != len(EXPECTED_LABELS):
        fail("Manifest capture evidence does not match the T25 inventory.")
    package = manifest.get("package")
    if not isinstance(package, dict) or re.fullmatch(r"[a-f0-9]{40}", str(package.get("gitCommit", ""))) is None:
        fail("Manifest lacks an exact product commit.")
    artifacts = package.get("artifacts")
    expected_artifacts = {
        "release/windows/win-unpacked/Ether.exe",
        "release/windows/win-unpacked/resources/app.asar",
    }
    if (
        not isinstance(artifacts, list)
        or len(artifacts) != len(expected_artifacts)
        or not all(isinstance(item, dict) for item in artifacts)
        or {item.get("path") for item in artifacts} != expected_artifacts
    ):
        fail("Manifest lacks the exact packaged executable identities.")
    for artifact in artifacts:
        digest = artifact.get("sha256")
        if not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
            fail(f"Manifest is missing package SHA-256 evidence: {artifact.get('path')}.")
        artifact_path = safe_repository_path(str(artifact.get("path", "")))
        if sha256(artifact_path.read_bytes()).hexdigest() != digest:
            fail(f"Manual package evidence is stale: {artifact.get('path')}.")
    captured_at = manifest.get("capturedAt")
    try:
        datetime.fromisoformat(str(captured_at).replace("Z", "+00:00"))
    except ValueError:
        fail("Manifest capturedAt must be an ISO-8601 timestamp.")
    private_value = find_private_value(manifest)
    if private_value is not None:
        fail(f"Manifest contains a private or machine-local path: {private_value}")
    return manifest


def find_private_value(value: object) -> str | None:
    if isinstance(value, dict):
        for child in value.values():
            found = find_private_value(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_private_value(child)
            if found is not None:
                return found
    elif isinstance(value, str):
        normalized = value.replace("\\", "/")
        if (
            re.search(r"[A-Za-z]:/Users/", normalized, re.IGNORECASE)
            or normalized.startswith("/home/")
            or normalized.startswith("file://")
        ):
            return value
    return None


def verify_captures(manifest: dict) -> None:
    evidence = {
        item.get("label"): item
        for item in manifest["captures"]
        if isinstance(item, dict) and isinstance(item.get("label"), str)
    }
    if set(evidence) != set(EXPECTED_LABELS):
        fail("Manifest capture evidence has missing or unexpected labels.")
    for label in EXPECTED_LABELS:
        record = evidence[label]
        image = safe_repository_path(str(record.get("path", "")))
        if not image.is_file():
            fail(f"Packaged action capture is missing: {image}")
        if any(token in image.name.lower() for token in ("placeholder", "fake", "mock", "dev")):
            fail(f"Placeholder or development screenshot found: {image.name}")
        raw = image.read_bytes()
        width, height = png_dimensions(raw)
        if (
            record.get("sha256") != sha256(raw).hexdigest()
            or record.get("width") != width
            or record.get("height") != height
        ):
            fail(f"Capture {label} does not match its manifest evidence.")
        result_path = safe_repository_path(str(record.get("sourceResult", "")))
        expected_image = result_path.parent / str(record.get("screenshotPath", ""))
        if expected_image.resolve() != image.resolve():
            fail(f"Capture {label} path does not match its journey screenshot path.")
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            fail(f"Capture {label} has no readable action result: {error}")
        if (
            result.get("mode") != "packaged"
            or result.get("outcome") != "passed"
            or result.get("profile", {}).get("kind") != "fresh-isolated"
            or result.get("identity", {}).get("gitCommit") != manifest["package"]["gitCommit"]
            or result.get("errors") != []
        ):
            fail(f"Capture {label} is not backed by a clean passing packaged journey.")
        result_artifacts = {
            item.get("path"): item.get("sha256")
            for item in result.get("identity", {}).get("artifacts", [])
            if isinstance(item, dict)
        }
        manifest_artifacts = {item["path"]: item["sha256"] for item in manifest["package"]["artifacts"]}
        if any(result_artifacts.get(path) != digest for path, digest in manifest_artifacts.items()):
            fail(f"Capture {label} journey package hashes diverge from the manifest.")
        action = next(
            (candidate for candidate in result.get("actions", []) if candidate.get("sequence") == record.get("actionSequence")),
            None,
        )
        if (
            not isinstance(action, dict)
            or action.get("kind") != "screenshot"
            or action.get("label") != record.get("actionLabel")
            or action.get("screenshotPath") != record.get("screenshotPath")
        ):
            fail(f"Capture {label} does not match a recorded screenshot action.")
        action_log = result_path.with_name("action-log.md")
        try:
            action_log_text = action_log.read_text(encoding="utf-8")
        except OSError as error:
            fail(f"Capture {label} has no readable action log: {error}")
        if "Outcome: passed" not in action_log_text or str(action.get("label")) not in action_log_text:
            fail(f"Capture {label} action log does not contain its passing screenshot action.")
        if width < 300 or height < 100 or image.stat().st_size < 2_048:
            fail(f"Capture {label} is too small for a legible manual figure.")
        luminance_range, luminance_bins = visual_signal(image)
        if luminance_range < 18 or luminance_bins < 4:
            fail(
                f"Capture {label} is blank or near-blank "
                f"(luminance range {luminance_range}, bins {luminance_bins})."
            )


def safe_repository_path(relative: str) -> Path:
    normalized = relative.replace("\\", "/")
    if not normalized or normalized.startswith("/") or ".." in normalized.split("/"):
        fail(f"Unsafe manual evidence path: {relative}")
    candidate = (ROOT / Path(*normalized.split("/"))).resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError:
        fail(f"Manual evidence escapes the repository: {relative}")
    return candidate


def png_dimensions(raw: bytes) -> tuple[int, int]:
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        fail("Release capture is not a valid PNG.")
    return struct.unpack(">II", raw[16:24])


def visual_signal(image: Path) -> tuple[int, int]:
    pixmap = fitz.Pixmap(str(image))
    try:
        channels = pixmap.n
        if channels < 3:
            fail(f"Rendered image has too few color channels: {image.name}")
        samples = memoryview(pixmap.samples)
        pixel_count = pixmap.width * pixmap.height
        stride = max(1, pixel_count // 20_000)
        luminance_bins: set[int] = set()
        minimum = 255
        maximum = 0
        for pixel_index in range(0, pixel_count, stride):
            offset = pixel_index * channels
            red, green, blue = samples[offset : offset + 3]
            luminance = (red * 54 + green * 183 + blue * 19) // 256
            minimum = min(minimum, luminance)
            maximum = max(maximum, luminance)
            luminance_bins.add(luminance // 8)
        return maximum - minimum, len(luminance_bins)
    finally:
        pixmap = None


def dereference(value):
    return value.get_object() if hasattr(value, "get_object") else value


def outline_titles(items: list) -> list[str]:
    titles: list[str] = []
    for item in items:
        if isinstance(item, list):
            titles.extend(outline_titles(item))
            continue
        title = getattr(item, "title", None)
        if title is None and hasattr(item, "get"):
            title = item.get("/Title")
        if isinstance(title, str):
            titles.append(title)
    return titles


def resolve_internal_destination_page(reader: PdfReader, destination) -> int | None:
    destination = dereference(destination)
    if isinstance(destination, str):
        named = reader.named_destinations.get(destination)
        if named is None and destination.startswith("/"):
            named = reader.named_destinations.get(destination[1:])
        return None if named is None else reader.get_destination_page_number(named)
    if hasattr(destination, "get") and destination.get("/D") is not None:
        return resolve_internal_destination_page(reader, destination.get("/D"))
    if not isinstance(destination, (list, tuple)) or not destination:
        return None
    page_reference = destination[0]
    if isinstance(page_reference, int):
        return page_reference if 0 <= page_reference < len(reader.pages) else None
    reference_id = (
        getattr(page_reference, "idnum", None),
        getattr(page_reference, "generation", None),
    )
    for page_index, page in enumerate(reader.pages):
        candidate = page.indirect_reference
        candidate_id = (
            getattr(candidate, "idnum", None),
            getattr(candidate, "generation", None),
        )
        if reference_id[0] is not None and candidate_id == reference_id:
            return page_index
        if dereference(page_reference) is dereference(candidate):
            return page_index
    return None


def verify_pdf_structure() -> tuple[PdfReader, int, int]:
    if not PDF_PATH.is_file():
        fail("Manual PDF is missing. Build it only after packaged-release capture succeeds.")
    if PDF_PATH.stat().st_size < 500_000:
        fail("Manual PDF is implausibly small.")
    reader = PdfReader(str(PDF_PATH))
    if len(reader.pages) < 12:
        fail("Manual PDF has too few pages for the release guide and capture atlas.")
    root_object = dereference(reader.trailer["/Root"])
    if root_object.get("/StructTreeRoot") is None:
        fail("Manual PDF is not tagged; /StructTreeRoot is missing.")
    mark_info = dereference(root_object.get("/MarkInfo", {}))
    if not bool(mark_info.get("/Marked")):
        fail("Manual PDF does not declare marked semantic content.")
    language = root_object.get("/Lang")
    if not isinstance(language, str) or not language.lower().startswith("en"):
        fail("Manual PDF must declare an English document language.")
    metadata = reader.metadata
    if metadata is None or metadata.title != "Ether 4.0 User Manual":
        fail("Manual PDF metadata title is missing or incorrect.")
    titles = set(outline_titles(reader.outline))
    missing_bookmarks = REQUIRED_BOOKMARKS - titles
    if missing_bookmarks:
        fail(f"Manual PDF outline is missing bookmarks: {', '.join(sorted(missing_bookmarks))}")
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    for phrase in REQUIRED_TEXT:
        if phrase not in text:
            fail(f"Manual PDF is missing required text: {phrase}")
    for mojibake in ("Â", "â€", "�"):
        if mojibake in text:
            fail(f"Manual PDF contains mojibake marker: {mojibake}")
    link_count = 0
    internal_link_count = 0
    for page in reader.pages:
        for annotation_reference in page.get("/Annots") or []:
            annotation = dereference(annotation_reference)
            if annotation.get("/Subtype") != "/Link":
                continue
            link_count += 1
            action = dereference(annotation.get("/A", {}))
            destination = annotation.get("/Dest")
            if destination is None and action.get("/S") == "/GoTo":
                destination = action.get("/D")
            if destination is not None:
                internal_link_count += 1
                destination_page = resolve_internal_destination_page(reader, destination)
                if destination_page is None:
                    fail("Manual PDF contains an internal link with an unresolved destination.")
                if destination_page < 0 or destination_page >= len(reader.pages):
                    fail(
                        "Manual PDF contains an internal link outside the document: "
                        f"page index {destination_page}."
                    )
            uri = action.get("/URI")
            if isinstance(uri, str) and uri.lower().startswith(("javascript:", "file:", "data:")):
                fail(f"Manual PDF contains an unsafe link: {uri}")
    if link_count < 10 or internal_link_count < 8:
        fail(
            f"Manual PDF needs semantic navigation links; found {link_count} links "
            f"and {internal_link_count} internal links."
        )
    return reader, link_count, internal_link_count


def verify_rendered_pages(expected_capture_count: int) -> tuple[int, int]:
    if RENDER_DIRECTORY.exists():
        shutil.rmtree(RENDER_DIRECTORY)
    RENDER_DIRECTORY.mkdir(parents=True)
    quality_pages: list[dict] = []
    image_xrefs: set[int] = set()
    document = fitz.open(PDF_PATH)
    try:
        for page_index, page in enumerate(document):
            page_number = page_index + 1
            width = page.rect.width
            height = page.rect.height
            if abs(width - 595.28) > 3 or abs(height - 841.89) > 3:
                fail(f"PDF page {page_number} is not A4: {width:.2f} x {height:.2f} points.")
            page_text = page.get_text("text").strip()
            image_information = page.get_image_info(xrefs=True)
            if not page_text and not image_information:
                fail(f"PDF page {page_number} is blank.")
            minimum_text_size = 100.0
            text_dictionary = page.get_text("dict")
            for block in text_dictionary.get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        content = span.get("text", "").strip()
                        if not content:
                            continue
                        size = float(span.get("size", 0))
                        minimum_text_size = min(minimum_text_size, size)
                        if size < 6.4:
                            fail(
                                f"PDF page {page_number} contains text below 6.4 pt: "
                                f"{size:.2f} pt ({content[:40]})."
                            )
                        x0, y0, x1, y1 = span["bbox"]
                        if x0 < -1 or y0 < -1 or x1 > width + 1 or y1 > height + 1:
                            fail(f"PDF page {page_number} contains clipped text: {content[:40]}")
            legible_capture_count = 0
            for image in image_information:
                xref = int(image.get("xref", 0))
                if xref > 0:
                    image_xrefs.add(xref)
                x0, y0, x1, y1 = image["bbox"]
                if x0 < -1 or y0 < -1 or x1 > width + 1 or y1 > height + 1:
                    fail(f"PDF page {page_number} contains an image outside the page boundary.")
                source_width = int(image.get("width", 0))
                source_height = int(image.get("height", 0))
                rendered_width = x1 - x0
                rendered_height = y1 - y0
                # Page 1 contains high-resolution brand marks intentionally rendered
                # at logo scale. Release-capture legibility applies to manual figures.
                if page_number > 1 and source_width >= 300 and source_height >= 100:
                    if rendered_width < 110 or rendered_height < 45:
                        fail(
                            f"PDF page {page_number} scales a release capture below the "
                            "legibility budget."
                        )
                    legible_capture_count += 1
            pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            output = RENDER_DIRECTORY / f"page-{page_number:03}.png"
            pixmap.save(output)
            if output.stat().st_size < 8_192:
                fail(f"Rendered PDF page is implausibly small: {output.name}")
            luminance_range, luminance_bins = visual_signal(output)
            if luminance_range < 18 or luminance_bins < 4:
                fail(
                    f"Rendered PDF page {page_number} is blank or near-blank "
                    f"(luminance range {luminance_range}, bins {luminance_bins})."
                )
            quality_pages.append(
                {
                    "page": page_number,
                    "widthPoints": round(width, 2),
                    "heightPoints": round(height, 2),
                    "minimumTextPoints": (
                        None if minimum_text_size == 100.0 else round(minimum_text_size, 2)
                    ),
                    "imageCount": len(image_information),
                    "legibleCaptureCount": legible_capture_count,
                    "render": output.name,
                    "renderBytes": output.stat().st_size,
                    "luminanceRange": luminance_range,
                    "luminanceBins": luminance_bins,
                }
            )
    finally:
        document.close()
    if len(image_xrefs) < expected_capture_count:
        fail(
            f"Manual PDF embeds only {len(image_xrefs)} unique images for "
            f"{expected_capture_count} release captures."
        )
    qa_path = RENDER_DIRECTORY / "qa.json"
    qa_path.write_text(
        json.dumps(
            {
                "pdf": PDF_PATH.name,
                "pageCount": len(quality_pages),
                "uniqueImageCount": len(image_xrefs),
                "pages": quality_pages,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return len(quality_pages), len(image_xrefs)


def main() -> None:
    manifest = load_manifest()
    verify_captures(manifest)
    _, link_count, internal_link_count = verify_pdf_structure()
    page_count, image_count = verify_rendered_pages(len(EXPECTED_LABELS))
    print(
        "Manual verified: "
        f"{page_count} A4 tagged pages, {len(EXPECTED_LABELS)} packaged captures, "
        f"{image_count} unique PDF images, {link_count} links "
        f"({internal_link_count} internal); rendered page QA: {RENDER_DIRECTORY}"
    )


if __name__ == "__main__":
    main()
