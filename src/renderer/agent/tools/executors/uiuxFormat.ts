/**
 * UI/UX tool result formatters
 */

export function formatUiuxResults(result: {
  domain: string
  query: string
  count: number
  results: Record<string, unknown>[]
  stack?: string
}): string {
  const lines: string[] = []

  if (result.stack) {
    lines.push(`## ${result.stack} Guidelines for "${result.query}"`)
  } else {
    lines.push(`## UI/UX ${result.domain} results for "${result.query}"`)
  }
  lines.push(`Found ${result.count} result(s)\n`)

  for (let i = 0; i < result.results.length; i++) {
    const item = result.results[i]
    lines.push(`### Result ${i + 1}`)

    for (const [key, value] of Object.entries(item)) {
      if (value && String(value).trim()) {
        lines.push(`- **${key}**: ${value}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function formatRecommendation(
  productType: string,
  rec: {
    product: Record<string, unknown> | null
    style: Record<string, unknown> | null
    prompt: Record<string, unknown> | null
    color: Record<string, unknown> | null
    typography: Record<string, unknown> | null
    landing: Record<string, unknown> | null
  },
): string {
  const lines: string[] = []

  lines.push(`# Design Recommendation for "${productType}"`)
  lines.push('')

  if (rec.product) {
    lines.push('## Product Analysis')
    lines.push(`- **Type**: ${rec.product['Product Type'] || productType}`)
    lines.push(`- **Recommended Style**: ${rec.product['Primary Style Recommendation'] || 'N/A'}`)
    lines.push(`- **Secondary Styles**: ${rec.product['Secondary Styles'] || 'N/A'}`)
    lines.push(`- **Color Focus**: ${rec.product['Color Palette Focus'] || 'N/A'}`)
    lines.push(`- **Key Considerations**: ${rec.product['Key Considerations'] || 'N/A'}`)
    lines.push('')
  }

  if (rec.style) {
    lines.push('## UI Style')
    lines.push(`- **Style**: ${rec.style['Style Category'] || 'N/A'}`)
    lines.push(`- **Keywords**: ${rec.style['Keywords'] || 'N/A'}`)
    lines.push(`- **Primary Colors**: ${rec.style['Primary Colors'] || 'N/A'}`)
    lines.push(`- **Effects**: ${rec.style['Effects & Animation'] || 'N/A'}`)
    lines.push(`- **Best For**: ${rec.style['Best For'] || 'N/A'}`)
    lines.push('')
  }

  if (rec.prompt) {
    lines.push('## Implementation Keywords')
    lines.push(`- **AI Prompt**: ${rec.prompt['AI Prompt Keywords (Copy-Paste Ready)'] || 'N/A'}`)
    lines.push(`- **CSS/Technical**: ${rec.prompt['CSS/Technical Keywords'] || 'N/A'}`)
    lines.push(`- **Design Variables**: ${rec.prompt['Design System Variables'] || 'N/A'}`)
    lines.push('')
  }

  if (rec.color) {
    lines.push('## Color Palette')
    lines.push(`- **Product Type**: ${rec.color['Product Type'] || 'N/A'}`)
    lines.push(`- **Primary**: ${rec.color['Primary Color'] || rec.color['Primary Colors'] || 'N/A'}`)
    lines.push(`- **Secondary**: ${rec.color['Secondary Color'] || rec.color['Secondary Colors'] || 'N/A'}`)
    lines.push(`- **Accent**: ${rec.color['Accent Color'] || rec.color['Accent Colors'] || 'N/A'}`)
    lines.push(`- **Background**: ${rec.color['Background'] || 'N/A'}`)
    lines.push('')
  }

  if (rec.typography) {
    lines.push('## Typography')
    lines.push(`- **Pairing**: ${rec.typography['Pairing Name'] || rec.typography['Font Pairing'] || 'N/A'}`)
    lines.push(`- **Heading Font**: ${rec.typography['Heading Font'] || 'N/A'}`)
    lines.push(`- **Body Font**: ${rec.typography['Body Font'] || 'N/A'}`)
    lines.push(`- **Google Fonts**: ${rec.typography['Google Fonts Import'] || 'N/A'}`)
    lines.push(`- **Tailwind Config**: ${rec.typography['Tailwind Config'] || 'N/A'}`)
    lines.push('')
  }

  if (rec.landing) {
    lines.push('## Landing Page Pattern')
    lines.push(`- **Pattern**: ${rec.landing['Pattern Name'] || 'N/A'}`)
    lines.push(`- **Section Order**: ${rec.landing['Section Order'] || 'N/A'}`)
    lines.push(`- **CTA Placement**: ${rec.landing['Primary CTA Placement'] || 'N/A'}`)
    lines.push(`- **Color Strategy**: ${rec.landing['Color Strategy'] || 'N/A'}`)
    lines.push(`- **Effects**: ${rec.landing['Recommended Effects'] || 'N/A'}`)
    lines.push('')
  }

  return lines.join('\n')
}
