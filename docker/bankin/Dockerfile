# „Изводи од банка“ – the SFTP drop box a bank pushes its statement files to (Халк Банка asked for an SFTP location
# + username / password). SFTP only: chrooted, no shell, no forwarding; the files land in the `bankin` volume, which
# the worker reads (folder connection /srv/bank-in/<bank>/in). Enabled on the WISE server only (COMPOSE_PROFILES=bankin).
FROM alpine:3.20
RUN apk add --no-cache openssh-server && rm -f /etc/ssh/ssh_host_*
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
