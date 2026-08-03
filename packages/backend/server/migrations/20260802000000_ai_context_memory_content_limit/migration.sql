ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_content_length_check"
  CHECK (length("content") <= 8000) NOT VALID;
