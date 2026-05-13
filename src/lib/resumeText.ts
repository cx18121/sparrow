const MAX_EXTRACTED_RESUME_CHARS = 100_000

function fileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

export function canExtractResumeText(file: File) {
  const ext = fileExtension(file.name)
  return (
    ext === 'txt'
    || ext === 'pdf'
    || ext === 'docx'
    || file.type.startsWith('text/')
    || file.type === 'application/pdf'
    || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

export function normalizeExtractedText(text: string) {
  return text
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/(^|[\s|,;])(?:[§€£¥¢©®™†‡¶•◦▪▫■□●○◆◇★☆✓✔✕✗ïı])(?=[\s|,;]|$)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_RESUME_CHARS)
}

export async function extractResumeTextFromFile(file: File): Promise<string> {
  const ext = fileExtension(file.name)
  if (ext === 'txt' || file.type.startsWith('text/')) {
    return normalizeExtractedText(await file.text())
  }

  if (ext === 'pdf' || file.type === 'application/pdf') {
    // Use the modern (non-legacy) minified pdfjs build:
    //   - pdf.min.mjs: 425 KB vs legacy/pdf.mjs 984 KB
    //   - pdf.worker.min.mjs: 1.2 MB vs legacy/pdf.worker.mjs 2.2 MB
    // The modern build drops support for browsers below ES2020 + modern
    // worker semantics — Safari < 16, Chrome < 80. Acceptable for Sparrow's
    // user base; if we ever need to support older browsers, swap back to
    // pdfjs-dist/legacy/build/*.
    const [{ default: workerSrc }, pdfjsLib] = await Promise.all([
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      import('pdfjs-dist/build/pdf.min.mjs'),
    ])
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item: any) => item.str || '').join(' '))
    }
    return normalizeExtractedText(pages.join('\n\n'))
  }

  if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // Minified mammoth: 621 KB vs unminified 864 KB.
    const mammoth = await import('mammoth/mammoth.browser.min')
    const api = (mammoth as any).default ?? mammoth
    const result = await api.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return normalizeExtractedText(result.value || '')
  }

  return ''
}
