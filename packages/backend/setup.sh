#!/bin/bash
set -e

echo "=== 51acgs Scraper 安装 ==="

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "错误: 未找到 python3，请先安装 Python 3.10+"
    exit 1
fi

echo "Python: $(python3 --version)"

# 安装依赖
echo "安装依赖..."
pip3 install -r requirements.txt -q

# 初始化数据库
echo "初始化数据库..."
python3 -m scraper.main init

echo ""
echo "安装完成！"
echo "运行 ./run.sh stats 查看状态"
echo "运行 ./run.sh --help 查看所有命令"
