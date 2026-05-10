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
    const [{ default: workerSrc }, pdfjsLib] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.worker.mjs?url'),
      import('pdfjs-dist/legacy/build/pdf.mjs'),
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
    const mammoth = await import('mammoth/mammoth.browser')
    const api = (mammoth as any).default ?? mammoth
    const result = await api.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return normalizeExtractedText(result.value || '')
  }

  return ''
}
