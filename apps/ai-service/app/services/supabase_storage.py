import base64
import json
import logging
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

from supabase import Client, create_client
from supabase.lib.client_options import ClientOptions

from app.settings import Settings

logger = logging.getLogger("archvision.ai.storage")


@dataclass(frozen=True)
class StoredModel:
    path: str
    signed_url: str


class SupabaseModelStorage:
    def __init__(self, settings: Settings) -> None:
        supabase_url = settings.supabase_url.strip()
        service_role_key = settings.supabase_service_role_key.strip()
        self._bucket = settings.supabase_bucket.strip()
        self._ttl = settings.signed_url_ttl_seconds
        logger.info(
            "Supabase Storage config: SUPABASE_URL configured=%s, "
            "SUPABASE_SERVICE_ROLE_KEY configured=%s, bucket=%s",
            bool(supabase_url),
            bool(service_role_key),
            self._bucket or "(empty)",
        )
        if not supabase_url or not service_role_key:
            raise RuntimeError("Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.")
        if not self._bucket:
            raise RuntimeError("Configura SUPABASE_BUCKET con un nombre de bucket válido.")
        parsed_url = urlparse(supabase_url)
        if parsed_url.scheme != "https" or not parsed_url.netloc:
            raise RuntimeError("SUPABASE_URL debe ser una URL HTTPS válida.")
        if self._jwt_role(service_role_key) != "service_role":
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY no es una JWT con role=service_role. "
                "No uses la clave anon/public para Storage del backend."
            )
        try:
            self._client: Client = create_client(
                supabase_url,
                service_role_key,
                options=ClientOptions(storage_client_timeout=20),
            )
        except Exception as error:
            raise RuntimeError(
                "No se pudo inicializar el cliente de Supabase Storage. "
                "Verifica SUPABASE_URL y la clave service-role configurada."
            ) from error
        self._ensure_private_bucket()

    @staticmethod
    def _jwt_role(token: str) -> str | None:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        try:
            payload = parts[1]
            decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
            claims = json.loads(decoded)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        role = claims.get("role") if isinstance(claims, dict) else None
        return role if isinstance(role, str) else None

    def _ensure_private_bucket(self) -> None:
        try:
            buckets = self._client.storage.list_buckets()
            existing = next(
                (bucket for bucket in buckets if bucket.name == self._bucket),
                None,
            )
            if existing is None:
                self._client.storage.create_bucket(
                    self._bucket,
                    options={"public": False},
                )
            elif existing.public:
                raise RuntimeError(
                    f"El bucket Supabase '{self._bucket}' debe ser privado."
                )
        except Exception:
            logger.exception(
                "Supabase Storage bucket check/create failed: bucket=%s",
                self._bucket,
            )
            raise

    @staticmethod
    def _exception_details(error: Exception) -> tuple[object, object]:
        response = getattr(error, "response", None)
        status = getattr(error, "status", None) or getattr(
            response, "status_code", None
        )
        code = getattr(error, "code", None)
        return status, code

    def _upload(
        self,
        path: str,
        contents: bytes,
        content_type: str,
    ) -> None:
        bucket = self._client.storage.from_(self._bucket)
        logger.info(
            "Uploading to Supabase Storage: credentials configured "
            "(SUPABASE_URL=true, SUPABASE_SERVICE_ROLE_KEY=true), "
            "bucket=%s, path=%s, content_type=%s",
            self._bucket,
            path,
            content_type,
        )
        try:
            bucket.upload(
                path,
                contents,
                file_options={"content-type": content_type},
            )
        except Exception as error:
            status, code = self._exception_details(error)
            logger.exception(
                "Supabase Storage upload failed: bucket=%s, path=%s, "
                "content_type=%s, http_status=%s, error_code=%s, "
                "exception_type=%s, error=%s",
                self._bucket,
                path,
                content_type,
                status,
                code,
                type(error).__name__,
                error,
            )
            raise

    def _create_signed_url(self, path: str) -> str:
        bucket = self._client.storage.from_(self._bucket)
        try:
            response = bucket.create_signed_url(path, self._ttl)
        except Exception as error:
            status, code = self._exception_details(error)
            logger.exception(
                "Supabase Storage signed URL failed: bucket=%s, path=%s, "
                "http_status=%s, error_code=%s, exception_type=%s, error=%s",
                self._bucket,
                path,
                status,
                code,
                type(error).__name__,
                error,
            )
            raise
        data = response.get("data", response)
        signed_url = data.get("signedURL") or data.get("signedUrl")
        if not signed_url:
            raise RuntimeError(
                f"Supabase no devolvió URL firmada para {self._bucket}/{path}."
            )
        return signed_url

    def upload_glb(self, contents: bytes) -> StoredModel:
        path = f"generated/{uuid.uuid4()}.glb"
        self._upload(path, contents, "model/gltf-binary")
        return StoredModel(path=path, signed_url=self._create_signed_url(path))

    def upload_floorplan_json(self, contents: bytes) -> StoredModel:
        path = f"floorplans/{uuid.uuid4()}.json"
        self._upload(path, contents, "application/json")
        return StoredModel(path=path, signed_url=self._create_signed_url(path))

    def upload_floorplan_glb(self, contents: bytes) -> StoredModel:
        path = f"floorplans/{uuid.uuid4()}.glb"
        self._upload(path, contents, "model/gltf-binary")
        return StoredModel(path=path, signed_url=self._create_signed_url(path))