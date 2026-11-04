"""
Core G-code injection and bed boundary clamping engine for PrusaLapse.
Pure Python module with zero external dependencies.
"""

from __future__ import annotations

import re
from typing import Any, Tuple

START_MARKER = "; --- PRUSA-LAPSE PARKED TIMELAPSE START ---"
END_MARKER = "; --- PRUSA-LAPSE PARKED TIMELAPSE END ---"

DEFAULT_BED_LIMITS = (250.0, 210.0)


def is_binary_bgcode(data: Any) -> bool:
    """
    Check if raw G-code bytes start with the binary .bgcode header magic bytes ('GCDE').

    Args:
        data: Raw bytes of the G-code file to inspect.

    Returns:
        True if the data begins with b'GCDE', False otherwise.
    """
    if not isinstance(data, (bytes, bytearray)):
        return False
    return data.startswith(b"GCDE")


def parse_bed_boundaries(gcode_text: str) -> tuple[float, float]:
    """
    Parse bed boundary limits (max_x, max_y) from G-code metadata comments
    such as '; bed_shape = ...' or '; printable_area = ...'.

    Defaults to (250.0, 210.0) if absent or unable to parse.

    Args:
        gcode_text: Complete G-code text contents.

    Returns:
        A tuple of (max_x, max_y) in millimeters.
    """
    if not gcode_text:
        return DEFAULT_BED_LIMITS

    pattern = re.compile(
        r"^;\s*(?:bed_shape|printable_area)\s*=\s*([^\r\n]+)",
        re.IGNORECASE | re.MULTILINE,
    )
    match = pattern.search(gcode_text)
    if not match:
        return DEFAULT_BED_LIMITS

    raw_coords = match.group(1)
    pair_pattern = re.compile(r"(-?\d+(?:\.\d+)?)\s*x\s*(-?\d+(?:\.\d+)?)")
    pairs = pair_pattern.findall(raw_coords)

    if not pairs:
        return DEFAULT_BED_LIMITS

    max_x = max(float(x) for x, _ in pairs)
    max_y = max(float(y) for _, y in pairs)
    return (max_x, max_y)


def calculate_park_target(
    park_x: float,
    park_y: float,
    bed_max_x: float,
    bed_max_y: float,
) -> tuple[float, float]:
    """
    Calculate safe toolhead parking coordinates clamped to the printer's bed limits.

    Ensures the target does not exceed bed_max - 10.0mm on either axis to prevent
    mechanical collisions on smaller beds (e.g. Prusa MINI 180x180 vs MK4 250x210).

    Args:
        park_x: Requested park X coordinate.
        park_y: Requested park Y coordinate.
        bed_max_x: Maximum bed X dimension.
        bed_max_y: Maximum bed Y dimension.

    Returns:
        A tuple of clamped (target_x, target_y).
    """
    target_x = min(float(park_x), float(bed_max_x) - 10.0)
    target_y = min(float(park_y), float(bed_max_y) - 10.0)
    return (target_x, target_y)


def _matches_marker(line: str, marker: str) -> bool:
    stripped = line.strip().upper()
    if stripped == marker:
        return True
    if stripped.startswith(marker) and len(stripped) > len(marker):
        next_char = stripped[len(marker)]
        if next_char in (" ", "\t", ";", "-"):
            return True
    return False


def inject_timelapse_gcode(
    gcode_text: str,
    config: dict[str, Any] | None = None,
) -> tuple[str, int]:
    """
    Inject toolhead parking and camera capture G-code at each layer change boundary.

    Enforces strict relative extrusion (M83) and safe bed boundary clamping.
    Preserves original line endings (CRLF vs LF).

    Args:
        gcode_text: Input G-code text.
        config: Dictionary containing injection configuration:
            - parkX / park_x: target X coordinate (default: 240.0)
            - parkY / park_y: target Y coordinate (default: 210.0)
            - zHopHeight / z_hop_height: Z-hop lift height (default: 0.4)
            - settleTime / settle_time: pause before capture in ms (default: 300)
            - captureTime / capture_time: pause for capture in ms (default: 1200)
            - bedMaxX / bed_max_x: optional override for max bed X
            - bedMaxY / bed_max_y: optional override for max bed Y

    Returns:
        A tuple of (modified_gcode_text, injection_count).
    """
    if config is None:
        config = {}

    if not gcode_text:
        return (gcode_text, 0)

    park_x = float(config.get("parkX", config.get("park_x", 240.0)))
    park_y = float(config.get("parkY", config.get("park_y", 210.0)))
    z_hop = float(config.get("zHopHeight", config.get("z_hop_height", 0.4)))
    settle_time = int(config.get("settleTime", config.get("settle_time", 300)))
    capture_time = int(config.get("captureTime", config.get("capture_time", 1200)))

    # Parse bed boundaries and clamp target
    bed_max_x, bed_max_y = parse_bed_boundaries(gcode_text)
    if "bedMaxX" in config:
        bed_max_x = float(config["bedMaxX"])
    elif "bed_max_x" in config:
        bed_max_x = float(config["bed_max_x"])

    if "bedMaxY" in config:
        bed_max_y = float(config["bedMaxY"])
    elif "bed_max_y" in config:
        bed_max_y = float(config["bed_max_y"])

    target_x, target_y = calculate_park_target(park_x, park_y, bed_max_x, bed_max_y)

    lines = gcode_text.splitlines(keepends=True)
    if not lines:
        return (gcode_text, 0)

    # Detect newline style
    nl = "\r\n" if any(line.endswith("\r\n") for line in lines) else "\n"

    # Identify primary layer marker: prefer ;AFTER_LAYER_CHANGE if present, else ;LAYER_CHANGE
    has_after_layer = any(
        _matches_marker(line, ";AFTER_LAYER_CHANGE") for line in lines
    )
    target_marker = ";AFTER_LAYER_CHANGE" if has_after_layer else ";LAYER_CHANGE"

    # Build injection snippet
    snippet_lines = [START_MARKER]
    if z_hop > 0:
        snippet_lines.extend([
            "G91 ; Relative positioning",
            f"G1 Z{z_hop:.1f} F600 ; Z-hop lift",
            "G90 ; Absolute positioning",
        ])
    snippet_lines.extend([
        "M83 ; Strict relative extrusion",
        f"G1 X{target_x:.1f} Y{target_y:.1f} F9000",
        f"G4 P{settle_time} ; Settle delay",
        "M220 S99 ; Trigger camera capture via PrusaLink",
        f"G4 P{capture_time} ; Dwell for multi-camera capture",
        "M220 S100 ; Restore normal 100% print speed",
    ])
    if z_hop > 0:
        snippet_lines.extend([
            "G91 ; Relative positioning",
            f"G1 Z-{z_hop:.1f} F600 ; Restore Z height",
            "G90 ; Absolute positioning",
        ])
    snippet_lines.append(END_MARKER)

    injected_block = "".join(l + nl for l in snippet_lines)

    output: list[str] = []
    count = 0
    i = 0
    num_lines = len(lines)

    while i < num_lines:
        line = lines[i]
        output.append(line)
        if _matches_marker(line, target_marker):
            # Guard against duplicate injection
            if i + 1 < num_lines and START_MARKER in lines[i + 1]:
                i += 1
                continue
            output.append(injected_block)
            count += 1
        i += 1

    return ("".join(output), count)
