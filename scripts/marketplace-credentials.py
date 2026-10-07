"""Collect replacement app credentials locally without echo or chat disclosure.

Does not contact Mercado Livre, rotate vault keys, or enable live synchronization.
"""
import argparse
import getpass
import os
from pathlib import Path
import re
import stat
import tempfile


def prepare(path, app_id, secret):
    if not re.fullmatch(r"[1-9][0-9]{5,31}", app_id):
        raise ValueError("Invalid ML application identifier")
    if not re.fullmatch(r"[A-Za-z0-9_+./=-]{16,256}", secret):
        raise ValueError("Invalid ML secret format")
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("An existing protected production environment file is required")
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError("Environment file must be readable only by its owner (chmod 600)")
    content = path.read_text()
    updates = {"ML_APP_ID": app_id, "ML_SECRET_KEY": secret, "ML_PKCE_ENABLED": "true", "MARKETPLACE_SOURCE": "MOCK"}
    lines = []
    written = set()
    for line in content.splitlines():
        key = line.partition("=")[0].strip()
        if key in updates:
            if key not in written:
                lines.append(f"{key}={updates[key]}")
                written.add(key)
        else:
            lines.append(line)
    lines.extend(f"{key}={value}" for key, value in updates.items() if key not in written)
    fd, temporary = tempfile.mkstemp(prefix=".credentials-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as output:
            output.write("\n".join(lines) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", default=".local/production.env")
    args = parser.parse_args()
    try:
        if not os.isatty(0):
            raise ValueError("Interactive local terminal required; credentials are never command arguments")
        app_id = input("Novo ID da aplicação Mercado Livre: ").strip()
        secret = getpass.getpass("Nova chave secreta (oculta): ").strip()
        if secret != getpass.getpass("Repita a chave secreta (oculta): ").strip():
            raise ValueError("Secret confirmation does not match")
        prepare(args.env_file, app_id, secret)
        print("Novas credenciais guardadas com permissão 0600. MARKETPLACE_SOURCE permanece MOCK; validação e ativação real são uma etapa separada.")
    except (ValueError, OSError, EOFError):
        raise SystemExit("Configuração não concluída. Verifique o arquivo protegido, o formato e a confirmação; nenhum valor será exibido.")
