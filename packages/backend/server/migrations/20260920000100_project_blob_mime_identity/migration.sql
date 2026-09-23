-- Keep existing content keys valid while allowing identical bytes with distinct MIME types.
ALTER TABLE project_blobs DROP CONSTRAINT project_blob_shape;
ALTER TABLE project_blobs ADD CONSTRAINT project_blob_shape CHECK (
  byte_size BETWEEN 0 AND 33554432 AND length(mime_type) > 0
  AND fingerprint ~ '^[a-f0-9]{64}$'
  AND (key = 'sha256-' || fingerprint
    OR key = 'sha256-' || fingerprint || '-' || left(encode(sha256(convert_to(mime_type, 'UTF8')), 'hex'), 16))
);
