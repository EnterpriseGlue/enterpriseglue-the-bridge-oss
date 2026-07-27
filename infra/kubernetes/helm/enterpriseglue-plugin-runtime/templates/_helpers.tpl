{{- define "enterpriseglue-plugin-runtime.name" -}}
{{- printf "%s" .id | replace "." "-" | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "enterpriseglue-plugin-runtime.fullname" -}}
{{- $base := printf "eg-plugin-%s" (replace "." "-" .plugin.id) -}}
{{- if le (len $base) 63 -}}
{{- $base -}}
{{- else -}}
{{- printf "%s-%s" ($base | trunc 52 | trimSuffix "-") (sha256sum .plugin.id | trunc 10) -}}
{{- end -}}
{{- end -}}

{{- define "enterpriseglue-plugin-runtime.pvcname" -}}
{{- $resource := include "enterpriseglue-plugin-runtime.fullname" . -}}
{{- $schema := "" -}}
{{- if gt (int .plugin.dataSchemaVersion) 0 -}}
{{- $schema = printf "-schema-%d" (int .plugin.dataSchemaVersion) -}}
{{- end -}}
{{- $base := printf "%s%s-%s" $resource $schema .storage.name -}}
{{- if le (len $base) 63 -}}
{{- $base -}}
{{- else -}}
{{- $identity := printf "%s:%d:%s" .plugin.id (int .plugin.dataSchemaVersion) .storage.name -}}
{{- printf "%s-%s" ($base | trunc 52 | trimSuffix "-") (sha256sum $identity | trunc 10) -}}
{{- end -}}
{{- end -}}

{{- define "enterpriseglue-plugin-runtime.labels" -}}
app.kubernetes.io/managed-by: {{ .root.Release.Service | quote }}
app.kubernetes.io/part-of: enterpriseglue-plugin-runtime
app.kubernetes.io/name: {{ include "enterpriseglue-plugin-runtime.fullname" . }}
io.enterpriseglue/plugin-id: {{ .plugin.id | quote }}
io.enterpriseglue/plugin-version: {{ .plugin.version | quote }}
{{- end -}}

{{- define "enterpriseglue-plugin-runtime.validate" -}}
{{- if ne (int .root.Values.pluginRuntime.schemaVersion) 1 -}}
{{- fail "pluginRuntime.schemaVersion must be 1" -}}
{{- end -}}
{{- if not (regexMatch "^[a-z0-9]+([.-][a-z0-9-]+)+$" .plugin.id) -}}
{{- fail (printf "invalid plugin ID: %s" .plugin.id) -}}
{{- end -}}
{{- if not (contains "@sha256:" .plugin.image) -}}
{{- fail (printf "plugin %s image must be digest pinned" .plugin.id) -}}
{{- end -}}
{{- if lt (int .plugin.dataSchemaVersion) 0 -}}
{{- fail (printf "plugin %s data schema must be non-negative" .plugin.id) -}}
{{- end -}}
{{- if not .plugin.service.runAsNonRoot -}}
{{- fail (printf "plugin %s must run as non-root" .plugin.id) -}}
{{- end -}}
{{- if not .plugin.service.readOnlyRootFilesystem -}}
{{- fail (printf "plugin %s must use a read-only root filesystem" .plugin.id) -}}
{{- end -}}
{{- end -}}
