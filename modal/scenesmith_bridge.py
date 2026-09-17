"""Client-only binding of pinned SceneSmith agents to a private Modal model.

No inference library is imported here. This module is also exercised locally
against an in-memory transport; real inference is restricted to the Modal runner.
"""
from __future__ import annotations

from copy import deepcopy
from urllib.parse import urlsplit

MODEL_REPOSITORY = "Qwen/Qwen3-VL-8B-Instruct"
# The SDK treats a slash in a model name as a provider prefix. Serve a plain
# alias so its default provider does not misread the Hugging Face organization.
MODEL = "eduworld-qwen3-vl-8b"
REVISION = "0c351dd01ed87e9c1b53cbc748cba10e6187ff3b"
SCENESMITH_REVISION = "67cc408fd38334b4a926efef45e284302ed5055b"


def private_base_url(value: str) -> str:
    url = urlsplit(value)
    if (url.scheme != "http" or url.hostname != "127.0.0.1" or
            not url.port or url.path.rstrip("/") != "/v1" or
            url.username or url.password or url.query or url.fragment):
        raise ValueError("Model endpoint must be an explicit private loopback /v1 URL")
    return value.rstrip("/")


def configure_agents(base_url: str, *, transport=None):
    import httpx
    from openai import AsyncOpenAI
    from agents import (set_default_openai_api, set_default_openai_client,
                        set_tracing_disabled)

    client = AsyncOpenAI(
        base_url=private_base_url(base_url), api_key="private-modal-loopback",
        max_retries=0, timeout=60,
        http_client=httpx.AsyncClient(transport=transport, trust_env=False,
                                     follow_redirects=False, timeout=60),
    )
    set_tracing_disabled(True)
    set_default_openai_api("chat_completions")
    set_default_openai_client(client, use_for_tracing=False)
    return client


def scene_agent_model(client):
    """Keep vLLM's JSON grammar from suppressing automatic tool calls.

    With tools present, describe the final schema in the instructions and let
    the Agents SDK validate final JSON normally. Tool-free structured requests
    still use constrained decoding. This adapter supports non-streaming runs.
    See vllm-project/vllm#39929; never silently accept invalid final output.
    """
    import json
    from agents import OpenAIChatCompletionsModel

    class SceneAgentModel(OpenAIChatCompletionsModel):
        async def get_response(self, system_instructions, input, model_settings,
                               tools, output_schema, handoffs, tracing,
                               previous_response_id=None, conversation_id=None, prompt=None):
            final_schema = output_schema
            if tools and output_schema is not None and not output_schema.is_plain_text():
                system_instructions = (system_instructions or "") + (
                    "\nUse the available tools to complete the task before giving a final answer. "
                    "When the work is complete, return only a JSON value matching this final "
                    "output schema, without markdown fences: " + json.dumps(output_schema.json_schema()))
                # Runner retains the original output schema and validates the answer.
                output_schema = None
            response = await super().get_response(
                system_instructions, input, model_settings, tools, output_schema,
                handoffs, tracing, previous_response_id, conversation_id, prompt)
            if final_schema is not None and not final_schema.is_plain_text():
                # Some models prefix their otherwise valid JSON with prose.
                # Extract only a single complete, schema-valid top-level value;
                # never invent missing fields, grades, or a tool result.
                for item in response.output:
                    if item.type == 'message':
                        for part in item.content:
                            if part.type == 'output_text':
                                part.text = extract_structured_value(part.text, final_schema)
            return response

        async def stream_response(self, *args, **kwargs):
            raise NotImplementedError("Scene agent adapter currently supports non-streaming runs only")
            yield  # Preserve the async iterator interface without falling back silently.

    return SceneAgentModel(model=MODEL, openai_client=client)


def extract_structured_value(text, schema):
    import json
    from agents import ModelBehaviorError
    decoder = json.JSONDecoder()
    values = []
    index = 0
    while index < len(text):
        if text[index] not in '{[':
            index += 1
            continue
        try:
            _, length = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            index += 1
            continue
        candidate = text[index:index+length]
        try:
            schema.validate_json(candidate)
        except ModelBehaviorError:
            pass
        else:
            values.append(candidate)
        index += length
    if len(values) > 1:
        raise ModelBehaviorError('Ambiguous structured output: multiple schema-valid values')
    # Invalid/missing output remains invalid for Runner's normal validation.
    return values[0] if values else text


def adapt_agent_config(config: dict) -> dict:
    """Return a copy with the model and optional provider-specific settings mapped.

    This is a language-model configuration adapter, not a full experiment config:
    image generation/editing and native SceneSmith dependencies remain separate.
    Summarization is disabled because upstream calls Responses directly there.
    """
    result = deepcopy(config)

    def visit(node):
        if isinstance(node, list):
            for value in node:
                visit(value)
        elif isinstance(node, dict):
            for key, value in list(node.items()):
                if key == "openai" and isinstance(value, dict):
                    if "model" in value:
                        value["model"] = MODEL
                    if "service_tier" in value:
                        value["service_tier"] = None
                    for option in ("reasoning_effort", "verbosity"):
                        if isinstance(value.get(option), dict):
                            value[option] = {name: None for name in value[option]}
                if key == "session_memory" and isinstance(value, dict):
                    value["enable_summarization"] = False
                    if "summarization_model" in value:
                        value["summarization_model"] = MODEL
                visit(value)
    visit(result)
    return result
