"""
EIS AI Service — Flask microservice
Endpoints:
  POST /transcribe   — Whisper speech-to-text
  POST /insights     — keyword extraction, action items, summarization
  POST /command      — natural language command via Claude API
  GET  /health       — health check
"""

import os
import json
import tempfile
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Lazy-load heavy models
_whisper_model = None
_nlp = None

def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        import whisper
        model_size = os.environ.get('WHISPER_MODEL', 'base')
        log.info(f'Loading Whisper model: {model_size}')
        _whisper_model = whisper.load_model(model_size)
    return _whisper_model

def get_nlp():
    global _nlp
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load('en_core_web_sm')
        except OSError:
            import subprocess
            subprocess.run(['python', '-m', 'spacy', 'download', 'en_core_web_sm'], check=True)
            _nlp = spacy.load('en_core_web_sm')
    return _nlp


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'eis-ai'})


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """Transcribe uploaded audio using OpenAI Whisper"""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file'}), 400

    audio_file = request.files['audio']
    suffix = '.webm' if 'webm' in audio_file.content_type else '.wav'

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        model = get_whisper()
        result = model.transcribe(tmp_path, fp16=False)
        text = result.get('text', '').strip()
        log.info(f'Transcribed {len(text)} chars')
        return jsonify({
            'text': text,
            'confidence': 0.95,
            'language': result.get('language', 'en')
        })
    except Exception as e:
        log.error(f'Transcription error: {e}')
        return jsonify({'error': str(e)}), 500
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@app.route('/insights', methods=['POST'])
def insights():
    """Extract keywords, action items, and summary from transcript"""
    data = request.get_json()
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    try:
        # Try Claude for high-quality NLP
        anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
        if anthropic_key:
            return jsonify(claude_insights(text, anthropic_key))
        else:
            return jsonify(spacy_insights(text))
    except Exception as e:
        log.error(f'Insights error: {e}')
        return jsonify(spacy_insights(text))


def claude_insights(text, api_key):
    """Use Claude API for high-quality insight extraction"""
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    # Truncate to avoid token limits
    truncated = text[:8000] if len(text) > 8000 else text

    prompt = f"""Analyze this meeting transcript and return ONLY valid JSON with:
- "keywords": list of 6-10 key business terms/topics (strings)
- "actions": list of action items/decisions (strings, max 8)
- "summary": 2-3 sentence executive summary (string)

Transcript:
{truncated}

Return only the JSON object, no markdown, no explanation."""

    message = client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=800,
        messages=[{'role': 'user', 'content': prompt}]
    )
    raw = message.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[1].rsplit('```', 1)[0]
    return json.loads(raw)


def spacy_insights(text):
    """Fallback NLP using spaCy"""
    nlp = get_nlp()
    doc = nlp(text[:10000])  # limit

    # Keywords from named entities + noun chunks
    keywords = list(set(
        [ent.text.lower() for ent in doc.ents
         if ent.label_ in ('ORG', 'PERSON', 'GPE', 'PRODUCT', 'EVENT', 'WORK_OF_ART')]
        + [chunk.text.lower() for chunk in doc.noun_chunks
           if len(chunk.text) > 4 and chunk.text.lower() not in _STOPWORDS]
    ))[:10]

    # Action items: sentences with modal verbs
    action_triggers = {'will', 'should', 'must', 'need', 'shall', 'want', 'plan'}
    actions = []
    for sent in doc.sents:
        tokens = {t.text.lower() for t in sent}
        if tokens & action_triggers and len(sent.text) > 20:
            actions.append(sent.text.strip())
        if len(actions) >= 6:
            break

    # Summary: first 3 substantial sentences
    sentences = [s.text.strip() for s in doc.sents if len(s.text) > 30]
    summary = ' '.join(sentences[:3])

    return {'keywords': keywords, 'actions': actions, 'summary': summary}


@app.route('/command', methods=['POST'])
def command():
    """Process natural language command against transcript"""
    data = request.get_json()
    cmd = data.get('command', '').strip()
    transcript = data.get('transcript', '').strip()

    if not cmd:
        return jsonify({'error': 'No command'}), 400

    anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
    if not anthropic_key:
        return jsonify({'result': 'AI command processing requires ANTHROPIC_API_KEY to be configured.'})

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=anthropic_key)
        truncated = transcript[:6000] if len(transcript) > 6000 else transcript

        message = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=600,
            system='You are an executive meeting intelligence assistant. Answer concisely and precisely.',
            messages=[{
                'role': 'user',
                'content': f'Meeting transcript:\n{truncated}\n\nCommand: {cmd}'
            }]
        )
        return jsonify({'result': message.content[0].text})
    except Exception as e:
        log.error(f'Command error: {e}')
        return jsonify({'error': str(e)}), 500


_STOPWORDS = {
    'this', 'that', 'with', 'from', 'have', 'been', 'were', 'will',
    'they', 'them', 'their', 'there', 'here', 'when', 'what', 'which',
    'would', 'could', 'should', 'just', 'also', 'like', 'some', 'than'
}

if __name__ == '__main__':
    port = int(os.environ.get('AI_PORT', 5001))
    log.info(f'EIS AI Service starting on :{port}')
    app.run(host='0.0.0.0', port=port, debug=False)
