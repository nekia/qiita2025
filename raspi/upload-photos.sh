#!/usr/bin/env bash
set -euo pipefail

zip_path="${1:-}"
pi_host="${2:-raspberrypi.local}"
remote_photos_dir="${3:-/home/pi/photos}"

if [[ -z "${zip_path}" ]]; then
  echo "Usage: $(basename "$0") <photos.zip> [pi_host] [remote_photos_dir]" >&2
  exit 1
fi

if [[ ! -f "${zip_path}" ]]; then
  echo "Zip file not found: ${zip_path}" >&2
  exit 1
fi

zip_basename="$(basename "${zip_path}")"
remote_tmp_dir="/tmp/photos_upload_$(date +%s)"

echo "Uploading ${zip_basename} to ${pi_host}..."
ssh "${pi_host}" "mkdir -p '${remote_photos_dir}' '${remote_tmp_dir}'"
scp "${zip_path}" "${pi_host}:${remote_tmp_dir}/${zip_basename}"

echo "Extracting on ${pi_host} into ${remote_photos_dir}..."
ssh "${pi_host}" "command -v unzip >/dev/null 2>&1 || { echo 'unzip not found. Please install it: sudo apt-get install -y unzip' >&2; exit 1; }"
ssh "${pi_host}" "unzip -o '${remote_tmp_dir}/${zip_basename}' -d '${remote_photos_dir}'"

echo "Cleaning up temporary files..."
ssh "${pi_host}" "rm -rf '${remote_tmp_dir}'"

echo "Done."
