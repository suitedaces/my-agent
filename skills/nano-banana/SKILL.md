---
name: image-gen
description: "Generate and edit images using the Gemini API. Text-to-image, image editing, multi-turn iteration, 4K resolution, search grounding."
metadata:
  { "requires": { "bins": ["curl", "jq"], "env": ["GEMINI_API_KEY"] } }
---

# Image Generation Skill

Generate and edit images via Gemini's native image generation API using `curl`.

## Models

| Model | ID | Best for |
|-------|----|----------|
| Nano Banana | `gemini-2.5-flash-image` | Fast, high-volume, low-latency |
| Nano Banana Pro | `gemini-3-pro-image-preview` | Pro asset production, complex prompts, accurate text rendering, 4K |

Default to `gemini-2.5-flash-image` unless the user asks for high quality, 4K, search grounding, or text-heavy images.

## Text-to-Image

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "YOUR PROMPT HERE"}]}]
  }' | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -D > output.png
```

Read the output image file to show it to the user.

## Image Editing (image + text → image)

Encode an existing image as base64 and send it alongside a text prompt:

```bash
BASE64_IMG=$(base64 -i input.png)

curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"contents\": [{
      \"parts\": [
        {\"text\": \"YOUR EDIT PROMPT HERE\"},
        {\"inline_data\": {\"mime_type\": \"image/png\", \"data\": \"$BASE64_IMG\"}}
      ]
    }]
  }" | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -D > output.png
```

## Pro Model Options

When using `gemini-3-pro-image-preview`, you can set aspect ratio and resolution:

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "YOUR PROMPT HERE"}]}],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": {
        "aspectRatio": "16:9",
        "imageSize": "2K"
      }
    }
  }' | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -D > output.png
```

### Aspect Ratios
`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9`

### Resolutions (Pro only)
`1K` (default), `2K`, `4K` — must be uppercase K.

## Search Grounding (Pro only)

Generate images based on real-time info (weather, news, etc.):

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "YOUR PROMPT HERE"}]}],
    "tools": [{"google_search": {}}],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"]
    }
  }' | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -D > output.png
```

## Handling Responses

The API returns JSON with parts that can contain text and/or image data. Extract text and image separately:

```bash
# save full response
RESPONSE=$(curl -s -X POST ... )

# extract text (if any)
echo "$RESPONSE" | jq -r '.candidates[0].content.parts[] | select(.text) | .text'

# extract and save image
echo "$RESPONSE" | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' | base64 -D > output.png
```

## Workflow

1. Understand what the user wants to generate or edit
2. Pick the right model (flash for speed, pro for quality/text/4K)
3. Write a detailed, descriptive prompt — more detail = better results
4. Run the curl command, save the image
5. Read the image file to display it inline
6. If the user wants edits, use the image editing flow with the previous output as input

## Tips

- Prompts should be descriptive and specific — style, composition, lighting, mood
- For image editing, describe what to change, not what to keep
- Pro model has a "thinking" mode — may take longer but produces better results
- All generated images include a SynthID watermark
- Pro supports up to 14 reference images in a single request (up to 6 objects + 5 humans)
- If the response has no `inlineData`, check for error messages in the JSON
