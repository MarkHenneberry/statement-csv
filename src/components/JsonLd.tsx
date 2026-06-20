/**
 * Renders a JSON-LD structured data block.
 * Pass any schema.org object; it is serialized into a script tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Structured data is generated from trusted, static site content.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
