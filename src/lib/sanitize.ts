// Utility functions for sanitizing content before sending to Claude API
// This prevents images from Tavily raw_content from being parsed as media

/**
 * Strips image references from text content to prevent Claude API from
 * treating them as media content.
 *
 * Removes:
 * - Markdown images: ![alt text](url)
 * - HTML img tags: <img src="url" ... />
 * - HTML picture elements
 * - HTML figure elements containing images
 * - Base64 data URLs
 */
export function stripImages(content: string): string {
  if (!content) return content;

  let result = content;

  // Remove markdown images: ![alt](url) or ![alt](url "title")
  result = result.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

  // Remove markdown reference-style images: ![alt][ref]
  result = result.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');

  // Remove HTML img tags (self-closing and regular)
  result = result.replace(/<img[^>]*\/?>/gi, '');

  // Remove HTML picture elements and their contents
  result = result.replace(/<picture[^>]*>[\s\S]*?<\/picture>/gi, '');

  // Remove HTML figure elements that likely contain images
  // (keeping other figures that might have code or tables)
  result = result.replace(/<figure[^>]*>[\s\S]*?<img[\s\S]*?<\/figure>/gi, '');

  // Remove source elements (used in picture elements)
  result = result.replace(/<source[^>]*\/?>/gi, '');

  // Remove base64 data URLs (they can be very long and cause issues)
  result = result.replace(/data:image\/[a-zA-Z]+;base64,[a-zA-Z0-9+/=]+/g, '[image data removed]');

  // Remove any SVG elements (can be inline images)
  result = result.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');

  // Clean up multiple consecutive newlines that might result from removals
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

/**
 * Sanitizes content for use in Claude API prompts.
 * This is the main function to call before embedding web content in prompts.
 */
export function sanitizeForClaude(content: string): string {
  return stripImages(content);
}
