# PrusaLapse Portable (Linux x64)

This is a **100% self-contained portable distribution** of PrusaLapse for Linux (x86_64).

## Zero Dependencies
* **No Node.js needed** (Bundled Node 20 LTS binary included).
* **No npm / build tools needed**.
* Works out-of-the-box on Ubuntu, Debian, Fedora, Arch, openSUSE, and other modern distributions.

---

## How to Run

1. Extract the `.tar.gz` archive to any directory:
   ```bash
   tar -xzf prusalapse-v1.3.0-linux-x64.tar.gz
   cd prusalapse-v1.3.0-linux-x64
   ```
2. Make the launcher executable (if not already set) and run it:
   ```bash
   chmod +x prusalapse
   ./prusalapse
   ```
3. Your default web browser will automatically open to `http://localhost:3000`.

---

## System Integration (Optional)
To add PrusaLapse to your desktop application launcher:
```bash
cp prusalapse.desktop ~/.local/share/applications/
```
