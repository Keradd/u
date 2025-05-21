#!/bin/bash

# WireGuard IPv6-only VPN installer with auto dependency check, client config download & QR code

WG_INTERFACE="wg0"
WG_PORT="51820"
SERVER_IP="fd86:ea04:1115::1/64"
CLIENT_IP="fd86:ea04:1115::2/64"
CLIENT_NAME="client"
CLIENT_CONF="${CLIENT_NAME}.conf"

# Fungsi cek dan install paket kalau belum ada
check_install() {
  for pkg in "$@"; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
      echo "Paket $pkg belum terinstall. Menginstall..."
      apt install -y "$pkg"
    else
      echo "Paket $pkg sudah terinstall."
    fi
  done
}

# Update repo dan upgrade dulu
apt update && apt upgrade -y

# Cek dan install dependencies yang dibutuhkan
check_install wireguard ip6tables qrencode curl openssh-server

# Enable IPv6 forwarding
if ! grep -q "^net.ipv6.conf.all.forwarding=1" /etc/sysctl.conf; then
  echo "Mengaktifkan IPv6 forwarding..."
  sed -i '/net.ipv6.conf.all.forwarding/c\net.ipv6.conf.all.forwarding=1' /etc/sysctl.conf || echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.conf
  sysctl -p
else
  echo "IPv6 forwarding sudah aktif."
fi

# Create keys directory
mkdir -p /etc/wireguard/keys
chmod 700 /etc/wireguard/keys

# Generate keys
SERVER_PRIVATE_KEY=$(wg genkey)
SERVER_PUBLIC_KEY=$(echo $SERVER_PRIVATE_KEY | wg pubkey)
CLIENT_PRIVATE_KEY=$(wg genkey)
CLIENT_PUBLIC_KEY=$(echo $CLIENT_PRIVATE_KEY | wg pubkey)

# Create server config
cat > /etc/wireguard/${WG_INTERFACE}.conf << EOF
[Interface]
Address = ${SERVER_IP}
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}

PostUp = sysctl -w net.ipv6.conf.all.forwarding=1; ip6tables -A FORWARD -i ${WG_INTERFACE} -j ACCEPT; ip6tables -A FORWARD -o ${WG_INTERFACE} -j ACCEPT
PostDown = ip6tables -D FORWARD -i ${WG_INTERFACE} -j ACCEPT; ip6tables -D FORWARD -o ${WG_INTERFACE} -j ACCEPT

[Peer]
PublicKey = ${CLIENT_PUBLIC_KEY}
AllowedIPs = ${CLIENT_IP}
EOF

# Get public IPv6 address
PUBLIC_IPV6=$(curl -6 -s https://ifconfig.co/ip)

# Create client config
cat > ~/${CLIENT_CONF} << EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE_KEY}
Address = ${CLIENT_IP}

[Peer]
PublicKey = ${SERVER_PUBLIC_KEY}
Endpoint = [${PUBLIC_IPV6}]:${WG_PORT}
AllowedIPs = ::/0
PersistentKeepalive = 25
EOF

# Set permissions
chmod 600 /etc/wireguard/${WG_INTERFACE}.conf
chmod 600 ~/${CLIENT_CONF}

# Enable and start WireGuard
systemctl enable wg-quick@${WG_INTERFACE}
systemctl start wg-quick@${WG_INTERFACE}

# Show info
echo "WireGuard IPv6-only VPN setup selesai!"
echo "File konfigurasi client: ~/${CLIENT_CONF}"
echo "Download file ini ke perangkat kamu dan import ke aplikasi WireGuard."

# Generate QR code for client config (for easy mobile import)
echo "QR code untuk konfigurasi client:"
qrencode -t ansiutf8 < ~/${CLIENT_CONF}

echo ""
echo "Jika kamu ingin download file client.conf ke PC, gunakan perintah SCP berikut dari komputer kamu:"
echo "scp root@${PUBLIC_IPV6}:~/${CLIENT_CONF} ./"
echo "(Ganti 'root' dengan user VPS kamu kalau bukan root.)"
