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
 * Strips LinkedIn boilerplate that pollutes fetched content.
 * LinkedIn post pages include "More Relevant Posts" by other people,
 * "People Also Viewed" sections, sign-in prompts, and navigation chrome.
 * Only the primary post content should survive.
 */
export function stripLinkedInBoilerplate(content: string, url: string): string {
  if (!/linkedin\.com/i.test(url)) return content;

  let result = content;

  // Remove "More Relevant Posts" / "Relevant posts" section and everything after
  result = result.replace(/(?:More Relevant Posts|Relevant posts|People also viewed|Others also viewed|Explore topics)[\s\S]*/i, '');

  // Remove "Recommended by LinkedIn" section
  result = result.replace(/Recommended by LinkedIn[\s\S]*/i, '');

  // Remove sign-in prompts
  result = result.replace(/Sign in to view [\s\S]{0,500}/gi, '');
  result = result.replace(/Join now to see [\s\S]{0,300}/gi, '');
  result = result.replace(/Sign in[\s\S]{0,100}to view/gi, '');

  // Remove "You might also like" section
  result = result.replace(/You might also like[\s\S]*/i, '');

  // Remove LinkedIn navigation/chrome
  result = result.replace(/(?:Home|My Network|Jobs|Messaging|Notifications)\s*[\|\/]\s*/gi, '');

  // Remove cookie/privacy banners
  result = result.replace(/(?:LinkedIn Corporation|©\s*\d{4}[\s\S]{0,200}(?:User Agreement|Privacy Policy|Cookie Policy))/gi, '');

  // Remove LinkedIn engagement UI
  result = result.replace(/\d+\s*(?:likes?|comments?|reposts?|reactions?)\s*/gi, '');
  result = result.replace(/(?:Like|Comment|Repost|Send)\s*(?:\||\s)+(?:Like|Comment|Repost|Send)\s*/gi, '');

  // Clean up resulting whitespace
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Sanitizes content for use in Claude API prompts.
 * This is the main function to call before embedding web content in prompts.
 */
export function sanitizeForClaude(content: string, url?: string): string {
  let result = stripImages(content);
  if (url) {
    result = stripLinkedInBoilerplate(result, url);
  }
  return result;
}
