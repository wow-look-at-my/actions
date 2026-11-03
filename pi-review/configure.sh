#!/usr/bin/env bash
set -euo pipefail

# Mirror the local pi config into ~/.pi/agent. The apiKey stays an env var name, so no secret lands on disk.

mkdir -p "$HOME/.pi/agent"

models_file="$HOME/.pi/agent/models.json"
settings_file="$HOME/.pi/agent/settings.json"

jq -n \
	--arg provider "$PROVIDER" \
	--arg url "$ENDPOINT" \
	--arg key "$API_KEY_ENV" \
	--arg model "$MODEL" \
	--arg name "$MODEL_NAME" \
	--argjson cw "$CONTEXT_WINDOW" \
	--argjson mt "$MAX_TOKENS" \
	--argjson reasoning "$REASONING" \
	'{
		providers: {
			($provider): {
				baseUrl: $url,
				api: "openai-completions",
				apiKey: $key,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false
				},
				models: [
					{
						id: $model,
						name: $name,
						reasoning: $reasoning,
						input: ["text", "image"],
						contextWindow: $cw,
						maxTokens: $mt,
						cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
					}
				]
			}
		}
	}' > "$models_file"

jq -n \
	--arg thinking "$DEFAULT_THINKING" \
	'{defaultThinkingLevel: $thinking}' \
	> "$settings_file"

echo "Wrote $models_file"
echo "Wrote $settings_file"
echo "Provider:        $PROVIDER"
echo "Endpoint:        $ENDPOINT"
echo "Model:           $MODEL ($MODEL_NAME)"
echo "Thinking level:  $DEFAULT_THINKING"
