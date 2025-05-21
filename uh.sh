#!/bin/bash

set -e

WG_INTERFACE="wg0"
WG_PORT="51820"
CLIENT_NAME="client"
CLIENT_CONF="${CLIENT_NAME}.conf"

REQUIRED_PACKAGES=(wireguard ip6tables qrencode curl openssh-server)

# Fungsi generate prefix ULA acak (fdxx:xxxx:xxxx::/64)
generate_ula_subnet() {
  ULA_PREFIX="fd$(openssl rand -hex 1):$(openssl rand -hex 2):$(openssl rand -hex 2)"
  echo "${ULA_PREFIX}"
}

echo "🧩 Memastikan semua dependensi tersedia..."

install_package() {
  if ! dpkg -s "$1" >/dev/null 2>&1; then
    echo "📦 Menginstall paket: $1"
    apt install -y "$1"
  else
    echo "✅ Paket $1 sudah terinstal."
  fi
}

echo "📥 Update repositori dan sistem..."
apt update && apt upgrade -y

for pkg in "${REQUIRED_PACKAGES[@]}"; do
  install_package "$pkg"
done

for cmd in wg ip6tables qrencode curl sshd; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ ERROR: Perintah '$cmd' tidak tersedia meskipun sudah install. Stop."
    exit 1
  fi
done

# Enable IPv6 forwarding
if ! grep -q "^net.ipv6.conf.all.forwarding=1" /etc/sysctl.conf; then
  echo "🔧 Mengaktifkan IPv6 forwarding..."
  echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf
  sysctl -p
else
  echo "✅ IPv6 forwarding sudah aktif."
fi

# Generate subnet dan IP
ULA_SUBNET=$(generate_ula_subnet)
SERVER_IP="${ULA_SUBNET}::1/64"
CLIENT_IP="${ULA_SUBNET}::2/64"

echo "🌐 Subnet ULA yang digunakan: ${ULA_SUBNET}::/64"
echo "🖥️ IP server: ${SERVER_IP}"
echo "📱 IP client: ${CLIENT_IP}"

# Generate key
mkdir -p /etc/wireguard/keys
chmod 700 /etc/wireguard/keys

echo "🔐 Membuat key server dan klien..."
SERVER_PRIVATE_KEY=$(wg genkey)
SERVER_PUBLIC_KEY=$(echo "$SERVER_PRIVATE_KEY" | wg pubkey)
CLIENT_PRIVATE_KEY=$(wg genkey)
CLIENT_PUBLIC_KEY=$(echo "$CLIENT_PRIVATE_KEY" | wg pubkey)

# Buat file konfigurasi server
cat > /etc/wireguard/${WG_INTERFACE}.conf <<EOF
[Interface]
Address = ${SERVER_IP}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}

PostUp = ip6tables -A FORWARD -i ${WG_INTERFACE} -j ACCEPT; ip6tables -A FORWARD -o ${WG_INTERFACE} -j ACCEPT
PostDown = ip6tables -D FORWARD -i ${WG_INTERFACE} -j ACCEPT; ip6tables -D FORWARD -o ${WG_INTERFACE} -j ACCEPT

[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
AllowedIPs = ${CLIENT_IP}
EOF

chmod 600 /etc/wireguard/${WG_INTERFACE}.conf

# Ambil IP publik IPv6
echo "🌐 Mendapatkan IPv6 publik dari VPS..."
PUBLIC_IPV6=$(curl -6 -s https://ifconfig.co/ip)

# Buat konfigurasi client
cat > ~/${CLIENT_CONF} <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE_KEY}
Address = ${CLIENT_IP}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = [${PUBLIC_IPV6}]:${WG_PORT}
AllowedIPs = ::/0
PersistentKeepalive = 25
EOF

chmod 600 ~/${CLIENT_CONF}

# Enable & Start WireGuard
systemctl enable wg-quick@${WG_INTERFACE}
systemctl start wg-quick@${WG_INTERFACE}

echo ""
echo "✅ WireGuard IPv6-only VPN berhasil di-setup!"
echo "📁 File konfigurasi klien: ~/${CLIENT_CONF}"

# QR code
echo "📱 QR Code untuk klien (scan via app WireGuard):"
qrencode -t ansiutf8 < ~/${CLIENT_CONF}

# Info SCP
echo ""
echo "💾 Untuk download konfigurasi ke PC:"
echo "scp root@[${PUBLIC_IPV6}]:~/${CLIENT_CONF} ./"
