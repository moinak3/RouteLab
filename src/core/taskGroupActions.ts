import type { DistinctTask, DistinctTaskBucket } from "../types";

export function confirmTaskGroup(groups: DistinctTaskBucket[], bucketId: string, reviewedAt = new Date().toISOString()) {
  return groups.map((group) => group.bucket_id === bucketId
    ? { ...group, review_status: "confirmed" as const, reviewed_at: reviewedAt }
    : group);
}

export function editTaskGroup(
  groups: DistinctTaskBucket[],
  bucketId: string,
  changes: { bucketName: string; task: DistinctTask },
  reviewedAt = new Date().toISOString(),
) {
  return groups.map((group) => group.bucket_id === bucketId
    ? {
      ...group,
      bucket_name: changes.bucketName.trim(),
      task: changes.task,
      review_status: "edited" as const,
      reviewed_at: reviewedAt,
      name_source: "user" as const,
    }
    : group);
}

export function taskGroupIdFromSearch(search: string) {
  return new URLSearchParams(search).get("taskGroup");
}
