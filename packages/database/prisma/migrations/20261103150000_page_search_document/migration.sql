-- Cross-wiki full-text search: one row per page of a project's live deployment.
CREATE TABLE "page_search_document" (
    "projectId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "headings" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "icon" TEXT,
    "textConfig" regconfig NOT NULL,
    "searchVector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector("textConfig", "title"), 'A') ||
        setweight(to_tsvector("textConfig", "headings"), 'B') ||
        setweight(to_tsvector("textConfig", "body"), 'C')
    ) STORED,

    CONSTRAINT "page_search_document_pkey" PRIMARY KEY ("projectId","deploymentId","languageCode","pageId")
);

CREATE INDEX "page_search_document_deploymentId_idx" ON "page_search_document"("deploymentId");
CREATE INDEX "page_search_document_searchVector_idx" ON "page_search_document" USING GIN ("searchVector");

ALTER TABLE "page_search_document" ADD CONSTRAINT "page_search_document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "page_search_document" ADD CONSTRAINT "page_search_document_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
