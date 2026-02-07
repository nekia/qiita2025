#!/usr/bin/env bash
set -euo pipefail

zip_path="${1:-}"
photos_dir="${2:-/home/pi/photos}"

if [[ -z "${zip_path}" ]]; then
  echo "Usage: $(basename "$0") <photos.zip> [photos_dir]" >&2
  exit 1
fi

if [[ ! -f "${zip_path}" ]]; then
  echo "Zip file not found: ${zip_path}" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip not found. Please install it: sudo apt-get install -y unzip" >&2
  exit 1
fi

echo "Extracting ${zip_path} into ${photos_dir}..."
mkdir -p "${photos_dir}"
unzip -o "${zip_path}" -d "${photos_dir}"
echo "Done."
